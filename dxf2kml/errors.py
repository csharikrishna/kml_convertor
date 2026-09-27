"""
Exception hierarchy for dxf2kml.

Every ``ConversionError`` carries a message that is safe to show to end users
(no filesystem paths, no stack traces). They subclass ``ValueError`` so existing
callers that catch ``ValueError`` keep working.
"""


class ConversionError(ValueError):
    """Base class for expected, user-facing conversion failures."""


class InputFileError(ConversionError):
    """The uploaded file is missing, empty, corrupt or not a CAD drawing."""


class DWGConversionError(ConversionError):
    """DWG input could not be converted to DXF (ODA File Converter missing or failed)."""


class CRSError(ConversionError):
    """Invalid, unsupported or implausible coordinate reference system."""


class LimitExceededError(ConversionError):
    """The drawing exceeds a configured resource limit (size, complexity or time)."""
