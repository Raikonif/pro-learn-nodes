"""Database connection.

Placeholder only. The SQLite engine, session factory, and `get_session`
dependency are introduced in the data-model phase; creating a live connection
here would be feature work this change explicitly excludes.
"""

# Intentionally no engine is constructed yet.
#
# Expected shape once the data model lands:
#
#     from sqlmodel import Session, create_engine
#     engine = create_engine(DATABASE_URL)
#     def get_session() -> Iterator[Session]:
#         with Session(engine) as session:
#             yield session
