"""Projects through the routes: membership, crossing links, archive, delete.

Each test names the spec scenario it proves. The routes are driven rather than
the services so the wire contract the frontend builds against is what is
asserted: field names, status codes, and the `{"graph": ...}` envelope.
"""

from __future__ import annotations

import pytest

from service import projects as projects_service
from core.secrets import InMemorySecretStore
from service.profile_service import ProfileService
from tests.test_session_routes import ADA, GRACE, client_for


@pytest.fixture
async def api(tmp_path):
    store = InMemorySecretStore()
    async with client_for(tmp_path, store) as client:
        ProfileService(store).enroll(ADA)
        yield client, store


def _by_name(graph: dict, name: str) -> dict:
    return next(p for p in graph["projects"] if p["name"] == name)


def _node(graph: dict, title: str) -> dict:
    return next(n for n in graph["nodes"] if n["title"] == title)


async def _project(client, name: str, instructions: str | None = None) -> str:
    graph = (await client.post("/workspace/projects", json={"name": name})).json()["graph"]
    project = _by_name(graph, name)["id"]
    if instructions is not None:
        await client.patch(f"/workspace/projects/{project}", json={"instructions": instructions})
    return project


async def _session(client, title: str, project: str | None = None) -> str:
    body = {"title": title} | ({"projectId": project} if project else {})
    response = await client.post("/workspace/nodes", json=body)
    assert response.status_code == 200, response.text
    return _node(response.json()["graph"], title)["id"]


async def _graph(client) -> dict:
    return (await client.get("/workspace/bootstrap")).json()["graph"]


async def _branch(client, source: str, project: str | None = None) -> dict:
    graph = await _graph(client)
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == source and t["anchor"] is None)
    message = (await client.post(
        "/workspace/messages", json={"threadId": thread, "role": "agent", "content": "A passage to branch."}
    )).json()["graph"]["messages"][-1]["id"]
    body = {"sourceNodeId": source, "anchor": {"messageId": message, "start": 0, "end": 9, "excerpt": "A passage"}}
    if project:
        body["projectId"] = project
    response = await client.post("/workspace/nodes/branch", json=body)
    assert response.status_code == 200, response.text
    return response.json()["graph"]


# --- Wire shape ------------------------------------------------------------


async def test_a_fresh_workspace_has_exactly_the_default_project(api):
    client, _ = api
    graph = await _graph(client)

    [default] = graph["projects"]
    assert set(default) == {"id", "name", "instructions", "isDefault", "createdAt"}
    assert (default["name"], default["instructions"], default["isDefault"]) == ("General", "", True)
    assert graph["archivedLinks"] == []


async def test_projects_list_the_default_first_then_by_creation(api):
    client, _ = api
    await _project(client, "Zeta")
    await _project(client, "Alpha")

    graph = await _graph(client)

    assert [p["name"] for p in graph["projects"]] == ["General", "Zeta", "Alpha"]


async def test_an_empty_project_name_is_refused(api):
    client, _ = api
    assert (await client.post("/workspace/projects", json={"name": "   "})).status_code == 422


async def test_rename_the_default_and_edit_instructions(api):
    client, _ = api
    default = (await _graph(client))["projects"][0]["id"]

    renamed = await client.patch(f"/workspace/projects/{default}", json={"name": "Everything", "instructions": "Be kind."})
    empty = await client.patch(f"/workspace/projects/{default}", json={"name": " "})

    [project] = renamed.json()["graph"]["projects"]
    assert (project["name"], project["instructions"], project["isDefault"]) == ("Everything", "Be kind.", True)
    assert empty.status_code == 422


# --- Scope -----------------------------------------------------------------


async def test_another_accounts_project_is_refused_exactly_as_a_missing_one(api):
    client, store = api
    service = ProfileService(store)
    service.enroll(GRACE)
    theirs = await _project(client, "Grace's")
    mine_node = None
    service.enroll(ADA)
    mine_node = await _session(client, "Mine")

    answers = []
    for target in (theirs, "no-such-project"):
        answers.append([
            (await client.patch(f"/workspace/projects/{target}", json={"name": "x"})).status_code,
            (await client.post(f"/workspace/projects/{target}/archive")).status_code,
            (await client.post(f"/workspace/projects/{target}/restore")).status_code,
            (await client.delete(f"/workspace/projects/{target}")).status_code,
            (await client.put(f"/workspace/nodes/{mine_node}/project", json={"projectId": target})).status_code,
            (await client.post("/workspace/nodes", json={"title": "n", "projectId": target})).status_code,
        ])

    assert answers[0] == answers[1] == [404] * 6
    graph = await _graph(client)
    assert [p["name"] for p in graph["projects"]] == ["General"]
    assert _node(graph, "Mine")["projectId"] == graph["projects"][0]["id"]


async def test_projects_are_listed_per_account(api):
    client, store = api
    await _project(client, "Ada's")
    service = ProfileService(store)
    service.enroll(GRACE)

    assert [p["name"] for p in (await _graph(client))["projects"]] == ["General"]
    assert (await client.get("/workspace/projects/archived")).json() == {"projects": []}


# --- Membership --------------------------------------------------------------


async def test_a_node_without_a_named_project_joins_the_default(api):
    client, _ = api
    node = await _session(client, "Plain")

    graph = await _graph(client)

    assert _node(graph, "Plain")["projectId"] == graph["projects"][0]["id"]
    assert node


async def test_a_root_session_can_start_in_a_named_project(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    await _session(client, "Groups", algebra)

    assert _node(await _graph(client), "Groups")["projectId"] == algebra


async def test_child_creation_inherits_the_parents_project(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    parent = await _session(client, "Groups", algebra)

    graph = (await client.post("/workspace/nodes/child", json={"parentNodeId": parent})).json()["graph"]

    child = next(n for n in graph["nodes"] if n["id"] != parent)
    assert child["projectId"] == algebra


async def test_a_branch_inherits_the_source_project_unless_one_is_named(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    topology = await _project(client, "Topology")
    source = await _session(client, "Groups", algebra)

    inherited = await _branch(client, source)
    crossing = await _branch(client, source, topology)

    first = next(n for n in inherited["nodes"] if n["id"] != source)
    second = next(n for n in crossing["nodes"] if n["id"] not in {source, first["id"]})
    assert (first["projectId"], second["projectId"]) == (algebra, topology)
    # The crossing link is stored and read back like any other.
    link = next(l for l in crossing["links"] if l["childId"] == second["id"])
    assert link["parentId"] == source


async def test_moving_changes_membership_and_nothing_else(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    topology = await _project(client, "Topology")
    source = await _session(client, "Groups", algebra)
    before = await _branch(client, source)
    child = next(n for n in before["nodes"] if n["id"] != source)["id"]

    after = (await client.put(f"/workspace/nodes/{source}/project", json={"projectId": topology})).json()["graph"]
    again = await client.put(f"/workspace/nodes/{source}/project", json={"projectId": topology})

    def strip(graph):
        return {n["id"]: {k: v for k, v in n.items() if k != "projectId"} for n in graph["nodes"]}

    assert _node(after, "Groups")["projectId"] == topology
    assert next(n for n in after["nodes"] if n["id"] == child)["projectId"] == algebra
    assert strip(after) == strip(before)
    assert after["links"] == before["links"] and after["threads"] == before["threads"]
    assert after["messages"] == before["messages"]
    assert again.status_code == 200 and _node(again.json()["graph"], "Groups")["projectId"] == topology


async def test_an_archived_project_is_not_a_destination(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    node = await _session(client, "Loose")
    await client.post(f"/workspace/projects/{algebra}/archive")

    moved = await client.put(f"/workspace/nodes/{node}/project", json={"projectId": algebra})
    created = await client.post("/workspace/nodes", json={"title": "x", "projectId": algebra})
    algebra_source = await _session(client, "Source")
    graph = await _graph(client)
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == algebra_source)
    message = (await client.post("/workspace/messages", json={"threadId": thread, "role": "agent", "content": "A passage."})).json()["graph"]["messages"][-1]["id"]
    branched = await client.post("/workspace/nodes/branch", json={
        "sourceNodeId": algebra_source, "projectId": algebra,
        "anchor": {"messageId": message, "start": 0, "end": 9, "excerpt": "A passage"},
    })

    assert (moved.status_code, created.status_code, branched.status_code) == (422, 422, 422)


# --- Archive -----------------------------------------------------------------


async def test_the_default_project_cannot_be_archived_or_deleted(api):
    client, _ = api
    default = (await _graph(client))["projects"][0]["id"]

    archived = await client.post(f"/workspace/projects/{default}/archive")
    deleted = await client.delete(f"/workspace/projects/{default}")

    assert (archived.status_code, deleted.status_code) == (422, 422)
    assert "default" in archived.json()["detail"].lower()
    assert [p["name"] for p in (await _graph(client))["projects"]] == ["General"]


async def test_archiving_takes_unarchived_nodes_and_restoring_returns_exactly_those(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    first = await _session(client, "One", algebra)
    second = await _session(client, "Two", algebra)
    aside = await _session(client, "Aside", algebra)
    await client.post(f"/workspace/nodes/{aside}/archive")

    archived = (await client.post(f"/workspace/projects/{algebra}/archive")).json()["graph"]
    listed = (await client.get("/workspace/projects/archived")).json()
    restored = (await client.post(f"/workspace/projects/{algebra}/restore")).json()["graph"]

    assert archived["nodes"] == [] and [p["name"] for p in archived["projects"]] == ["General"]
    assert [(p["id"], p["name"], p["nodeCount"]) for p in listed["projects"]] == [(algebra, "Algebra", 3)]
    assert set(listed["projects"][0]) == {"id", "name", "archivedAt", "nodeCount"}
    assert {n["id"] for n in restored["nodes"]} == {first, second}, "the node archived on its own stays archived"
    assert [p["name"] for p in restored["projects"]] == ["General", "Algebra"]
    # And that node restores on its own afterwards.
    again = (await client.post(f"/workspace/nodes/{aside}/restore")).json()["graph"]
    assert aside in {n["id"] for n in again["nodes"]}
    assert (await client.get("/workspace/projects/archived")).json() == {"projects": []}


async def test_archiving_closes_the_open_node(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    node = await _session(client, "Open", algebra)
    await client.put("/workspace/context", json={"lastOpenNodeId": node, "viewport": {}})

    bootstrap = (await client.post(f"/workspace/projects/{algebra}/archive")).json()
    assert bootstrap["graph"]["nodes"] == []
    assert (await client.get("/workspace/bootstrap")).json()["context"]["lastOpenNodeId"] is None


async def test_restoring_a_node_of_an_archived_project_is_refused_with_the_name(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    node = await _session(client, "Groups", algebra)
    await client.post(f"/workspace/projects/{algebra}/archive")

    refused = await client.post(f"/workspace/nodes/{node}/restore")

    assert refused.status_code == 422
    assert refused.json()["detail"] == "Restore the project Algebra first"
    found = (await client.get("/workspace/sessions/search", params={"q": "Groups", "includeArchived": "true"})).json()
    assert [(r["nodeId"], r["archived"]) for r in found["results"]] == [(node, True)]


async def test_moving_a_node_out_of_an_archived_project_leaves_it_archived_on_its_own(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    topology = await _project(client, "Topology")
    node = await _session(client, "Groups", algebra)
    await client.post(f"/workspace/projects/{algebra}/archive")

    moved = await client.put(f"/workspace/nodes/{node}/project", json={"projectId": topology})
    restored_project = (await client.post(f"/workspace/projects/{algebra}/restore")).json()["graph"]
    restored_node = await client.post(f"/workspace/nodes/{node}/restore")

    assert moved.status_code == 200 and moved.json()["graph"]["nodes"] == []
    assert node not in {n["id"] for n in restored_project["nodes"]}, "the project's restore does not take it back"
    assert node in {n["id"] for n in restored_node.json()["graph"]["nodes"]}


async def test_archiving_the_nodes_of_one_project_leaves_the_others(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    other = await _session(client, "Elsewhere")
    await _session(client, "Groups", algebra)

    graph = (await client.post(f"/workspace/projects/{algebra}/archive")).json()["graph"]

    assert [n["id"] for n in graph["nodes"]] == [other]


async def test_the_archive_cascade_is_atomic(api, monkeypatch):
    client, _ = api
    algebra = await _project(client, "Algebra")
    await _session(client, "One", algebra)
    await _session(client, "Two", algebra)

    def fail(_workspace):
        raise RuntimeError("fails after every node was stamped")

    monkeypatch.setattr(projects_service, "_bump_revision", fail)
    with pytest.raises(RuntimeError):
        projects_service.archive(
            (await client.get("/workspace/bootstrap")).json()["workspaceId"], algebra
        )
    monkeypatch.undo()

    graph = await _graph(client)
    assert {n["title"] for n in graph["nodes"]} == {"One", "Two"}
    assert "Algebra" in {p["name"] for p in graph["projects"]}


# --- Links to archived material ---------------------------------------------


async def test_a_link_to_an_archived_node_is_reported_and_restoring_draws_it_again(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    topology = await _project(client, "Topology")
    source = await _session(client, "Groups", algebra)
    crossed = await _branch(client, source, topology)
    child = next(n for n in crossed["nodes"] if n["id"] != source)["id"]

    archived = (await client.post(f"/workspace/projects/{topology}/archive")).json()["graph"]
    stored_while_hidden = archived["links"]
    restored = (await client.post(f"/workspace/projects/{topology}/restore")).json()["graph"]

    assert stored_while_hidden == []
    assert archived["archivedLinks"] == [
        {"nodeId": source, "archivedNodeId": child, "archivedTitle": "A passage"}
    ]
    assert restored["archivedLinks"] == []
    assert [(l["parentId"], l["childId"]) for l in restored["links"]] == [(source, child)]


async def test_a_parent_archived_individually_is_reported_from_its_child(api):
    client, _ = api
    source = await _session(client, "Groups")
    crossed = await _branch(client, source)
    child = next(n for n in crossed["nodes"] if n["id"] != source)["id"]

    graph = (await client.post(f"/workspace/nodes/{source}/archive")).json()["graph"]

    assert graph["archivedLinks"] == [{"nodeId": child, "archivedNodeId": source, "archivedTitle": "Groups"}]


async def test_a_link_with_both_ends_archived_is_not_reported(api):
    client, _ = api
    source = await _session(client, "Groups")
    crossed = await _branch(client, source)
    child = next(n for n in crossed["nodes"] if n["id"] != source)["id"]
    await client.post(f"/workspace/nodes/{source}/archive")

    graph = (await client.post(f"/workspace/nodes/{child}/archive")).json()["graph"]

    assert graph["archivedLinks"] == []


# --- Delete ------------------------------------------------------------------


async def test_deleting_a_project_moves_every_member_to_the_default_and_keeps_archive_state(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    live = await _session(client, "Live", algebra)
    taken = await _session(client, "Taken", algebra)
    aside = await _session(client, "Aside", algebra)
    await client.post(f"/workspace/nodes/{aside}/archive")
    await client.post(f"/workspace/projects/{algebra}/archive")
    # One more restored to prove an unarchived node moves too.
    await client.post(f"/workspace/projects/{algebra}/restore")
    await client.post(f"/workspace/nodes/{taken}/archive")

    graph = (await client.delete(f"/workspace/projects/{algebra}")).json()["graph"]

    default = graph["projects"][0]["id"]
    assert [p["name"] for p in graph["projects"]] == ["General"]
    assert [(n["id"], n["projectId"]) for n in graph["nodes"]] == [(live, default)]
    listed = [r["nodeId"] for r in (await client.get("/workspace/sessions/search", params={"q": "a", "includeArchived": "true"})).json()["results"]]
    assert {taken, aside} <= set(listed)
    # Still archived, and now restorable on their own because the default is never archived.
    assert (await client.post(f"/workspace/nodes/{aside}/restore")).status_code == 200


async def test_deleting_an_archived_project_moves_its_nodes_and_clears_the_marker(api):
    client, _ = api
    algebra = await _project(client, "Algebra")
    node = await _session(client, "Groups", algebra)
    await client.post(f"/workspace/projects/{algebra}/archive")

    deleted = await client.delete(f"/workspace/projects/{algebra}")
    restored = await client.post(f"/workspace/nodes/{node}/restore")

    assert deleted.status_code == 200 and deleted.json()["graph"]["nodes"] == []
    assert restored.status_code == 200
    [only] = restored.json()["graph"]["nodes"]
    assert only["projectId"] == restored.json()["graph"]["projects"][0]["id"]
    assert (await client.get("/workspace/projects/archived")).json() == {"projects": []}

