"""Domain-specific exceptions.

Layers raise these rather than HTTP errors, so business logic stays free of
FastAPI concerns. The API layer is responsible for translating them into
responses.
"""


class DomainError(Exception):
    """Base class for all domain errors raised by service and repository layers."""


class NotFoundError(DomainError):
    """A requested entity does not exist."""


class ValidationError(DomainError):
    """An operation violates a domain rule."""
