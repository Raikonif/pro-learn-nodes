"""Enrolled account records.

A profile is an account that has signed in on this device at least once.
Which profile is *active* is deliberately not here: that pointer lives in
`SecretStore`, so sign-out can destroy it outright and so it is not copied
into every timestamped backup `core/migrations.py` takes before a migration.
"""

from datetime import datetime

from sqlalchemy import Column, Index, String
from sqlmodel import Field, SQLModel

# Imported rather than redefined. A second local `now()` is how two tables end
# up with timestamps from different clocks or different tzinfo conventions.
from models.workspace import new_id, now


class ProfileRecord(SQLModel, table=True):
    __tablename__ = "profiles"
    # The pair is the identity, enforced by the database rather than by a
    # read-then-write in the service: two sign-ins racing on a new account
    # would both see no existing row and both insert.
    __table_args__ = (Index("uq_profile_identity", "provider", "subject", unique=True),)

    id: str = Field(default_factory=new_id, primary_key=True)
    provider: str = Field(sa_column=Column(String, nullable=False))
    # The provider's immutable subject claim, never an email address: OIDC
    # subjects are stable for the life of the account while email addresses
    # are reassigned to different people.
    subject: str = Field(sa_column=Column(String, nullable=False))
    # Display-only, and refreshed from the provider on every sign-in. Nullable
    # because a provider may withhold any of them, and because the local
    # development adapter has no upstream directory to read them from.
    email: str | None = Field(default=None, sa_column=Column(String))
    display_name: str | None = Field(default=None, sa_column=Column(String))
    avatar_url: str | None = Field(default=None, sa_column=Column(String))
    created_at: datetime = Field(default_factory=now, nullable=False)
