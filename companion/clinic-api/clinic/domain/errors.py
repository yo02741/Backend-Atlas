"""業務錯誤。這一層不知道 HTTP：狀態碼與 Problem Details 的對應在 clinic/api/errors.py。"""


class BookingError(Exception):
    """所有掛號規則錯誤的共同父類別；API 層接住它就接住全部業務規則錯誤。"""


class AlreadyBooked(BookingError):
    pass


class SessionFull(BookingError):
    pass


class DailyLimitExceeded(BookingError):
    pass


class CancelDeadlinePassed(BookingError):
    pass


class InvalidStatus(BookingError):
    """狀態不允許這個轉換：已取消或已報到的掛號不能再取消、報到。"""


class NotFound(Exception):
    """資源不存在，或這位使用者看不到（兩者對外不區分）。"""


class PermissionDenied(Exception):
    """知道是誰，但這個角色不能做這件事。"""


class Unauthenticated(Exception):
    """沒有憑證、憑證無效或過期。"""
