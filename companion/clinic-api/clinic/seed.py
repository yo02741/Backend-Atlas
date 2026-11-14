"""建立虛構的範例資料與測試帳號：python -m clinic.seed

密碼不寫在程式裡：從環境變數 SEED_PASSWORD 讀；沒設定就隨機產生並印出一次。
資料庫裡只存 Argon2id 雜湊。已經有使用者時不重複建立。
"""

import os
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from clinic.config import to_sqlalchemy_url
from clinic.db import make_engine
from clinic.domain.rules import TPE
from clinic.repository.tables import DoctorRow, PatientRow, SessionRow, UserRow
from clinic.service.auth import hash_password


def seed(db: DbSession, password: str) -> dict[str, object]:
    doctors = [DoctorRow(name="林醫師", dept="家醫科"), DoctorRow(name="張醫師", dept="小兒科")]
    patients = [PatientRow(name="王小明"), PatientRow(name="陳小華"), PatientRow(name="李大同")]
    db.add_all([*doctors, *patients])
    db.flush()

    day = datetime.now(TPE).date() + timedelta(days=7)  # 一週後：還在取消期限內
    sessions = [
        SessionRow(doctor_id=doctors[0].id, session_date=day, period="morning", capacity=2),
        SessionRow(doctor_id=doctors[0].id, session_date=day, period="afternoon", capacity=30),
        SessionRow(doctor_id=doctors[1].id, session_date=day, period="morning", capacity=30),
    ]
    password_hash = hash_password(password)
    users = [
        UserRow(username="patient1", password_hash=password_hash, role="patient", patient_id=patients[0].id),
        UserRow(username="patient2", password_hash=password_hash, role="patient", patient_id=patients[1].id),
        UserRow(username="desk1", password_hash=password_hash, role="desk"),
        UserRow(username="doctor1", password_hash=password_hash, role="doctor", doctor_id=doctors[0].id),
    ]
    db.add_all([*sessions, *users])
    db.commit()
    return {"date": day.isoformat(), "doctor_id": doctors[0].id, "session_id": sessions[0].id,
            "users": [u.username for u in users]}  # fmt: skip


def main() -> None:
    engine = make_engine(to_sqlalchemy_url(os.environ["DATABASE_URL"]))
    with DbSession(engine) as db:
        if db.scalar(select(func.count()).select_from(UserRow)):
            print("已經有使用者，略過 seed。")
            return
        password = os.environ.get("SEED_PASSWORD") or secrets.token_urlsafe(12)
        info = seed(db, password)
    print(f"帳號：{', '.join(info['users'])}")  # type: ignore[arg-type]
    if not os.environ.get("SEED_PASSWORD"):
        print(f"密碼（隨機產生，只顯示這一次）：{password}")
    print(f"林醫師 doctor_id={info['doctor_id']}，診次日期 {info['date']}")
    print(f"上午診 session_id={info['session_id']}（名額 2）")


if __name__ == "__main__":
    main()
