"""授權規則寫成資料：角色 × 動作 × 範圍。查不到的組合就是不允許（預設拒絕）。"""

from clinic.domain.models import Principal

# "any"：全部；其他字串：使用者與資源上這個欄位要相等
POLICY: dict[str, dict[str, str]] = {
    "desk": {"book": "any", "read": "any", "cancel": "any", "check_in": "any"},
    "patient": {"book": "patient_id", "read": "patient_id", "cancel": "patient_id"},
    "doctor": {"read": "doctor_id"},
}


def can(user: Principal | None, action: str, resource: object) -> bool:
    """resource 是帶有 patient_id／doctor_id 屬性的物件（掛號，或「要替誰掛號」）。"""
    if user is None:
        return False
    scope = POLICY.get(user.role, {}).get(action)
    if scope is None:
        return False
    if scope == "any":
        return True
    mine = getattr(user, scope, None)
    return mine is not None and mine == getattr(resource, scope, None)  # 擋掉 None == None
