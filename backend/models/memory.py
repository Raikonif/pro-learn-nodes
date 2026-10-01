"""What agents have proposed a learner knows, and what the learner accepted.

Per account, not per node (roadmap Phase 11). Nothing is deleted: a rejected
proposal stays so the same fact is not simply proposed again unrecorded, and
an accepted memory that is revised keeps its earlier text as `superseded`.
"""

from datetime import datetime

from sqlalchemy import Column, Index, String, Text, text
from sqlmodel import Field, SQLModel

from models.workspace import new_id, now


class MemoryRecord(SQLModel, table=True):
    __tablename__ = "memories"
    __table_args__ = (
        # One accepted memory per topic: a topic names one evolving fact.
        Index(
            "uq_accepted_memory_topic",
            "profile_id",
            "topic",
            unique=True,
            sqlite_where=text("status = 'accepted' AND topic IS NOT NULL"),
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    profile_id: str = Field(foreign_key="profiles.id", nullable=False, index=True)
    text: str = Field(sa_column=Column(Text, nullable=False))
    topic: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    # pending | accepted | rejected | removed | superseded
    status: str = Field(sa_column=Column(String, nullable=False))
    # A pending revision names the accepted memory it would replace; an
    # accepted or superseded row names the memory it continues.
    revises_id: str | None = Field(default=None, foreign_key="memories.id", nullable=True)
    proposed_by_name: str = Field(sa_column=Column(String, nullable=False))
    source_node_id: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    created_at: datetime = Field(default_factory=now, nullable=False)
    decided_at: datetime | None = Field(default=None, nullable=True)
