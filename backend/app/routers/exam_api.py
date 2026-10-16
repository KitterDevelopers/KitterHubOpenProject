"""Kitter考试 · 后端（从零重写，新文件：不复用任何旧实现）

与社区主站共用 FastAPI 应用 / SQLite / JWT：
  考生端  /api/exam/*
  管理端  /api/admin/exam/*（admin 角色）
表名统一 ex_ 前缀；本文件自带幂等建表。

题型 qtype: single / multiple / judge / fill / short（前四种交卷即判，short 人工阅卷）
一次考试默认只考一次，管理员可重置；限时按 exam.duration_min，交卷给 60 秒宽限；
exam.students 为空 = 公开，非空 = 仅名单内可参加。
"""
import json
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Session

from ..database import Base, engine
from ..deps import get_current_admin, get_current_user, get_db

student = APIRouter(prefix="/exam", tags=["exam"])
admin = APIRouter(prefix="/admin/exam", tags=["exam-admin"])

QTYPES = ("single", "multiple", "judge", "fill", "short")
OBJECTIVE = ("single", "multiple", "judge", "fill")
GRACE = 60


# --------------------------------------------------------------------- 表
class ExQuestion(Base):
    __tablename__ = "ex_questions"
    id = Column(Integer, primary_key=True)
    qtype = Column(String(16), nullable=False, default="single")
    stem = Column(Text, nullable=False)
    options = Column(Text, default="[]")
    answer = Column(Text, default="")
    analysis = Column(Text, default="")
    score = Column(Float, default=5.0)
    difficulty = Column(Integer, default=1)
    category = Column(String(64), default="")
    created_by = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)


class ExExam(Base):
    __tablename__ = "ex_exams"
    id = Column(Integer, primary_key=True)
    title = Column(String(160), nullable=False)
    description = Column(Text, default="")
    status = Column(String(16), default="draft")
    start_at = Column(DateTime)
    end_at = Column(DateTime)
    duration_min = Column(Integer, default=0)
    pass_score = Column(Float, default=60.0)
    shuffle = Column(Boolean, default=False)
    show_result = Column(Boolean, default=True)
    show_analysis = Column(Boolean, default=False)
    created_by = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExPaperItem(Base):
    __tablename__ = "ex_paper_items"
    __table_args__ = (UniqueConstraint("exam_id", "question_id", name="uq_ex_paper"),)
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, ForeignKey("ex_exams.id", ondelete="CASCADE"), index=True)
    question_id = Column(Integer, ForeignKey("ex_questions.id", ondelete="CASCADE"))
    order_no = Column(Integer, default=0)
    score = Column(Float, default=5.0)


class ExStudent(Base):
    __tablename__ = "ex_students"
    __table_args__ = (UniqueConstraint("exam_id", "user_id", name="uq_ex_student"),)
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, ForeignKey("ex_exams.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, index=True)


class ExAttempt(Base):
    __tablename__ = "ex_attempts"
    id = Column(Integer, primary_key=True)
    exam_id = Column(Integer, ForeignKey("ex_exams.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, index=True)
    status = Column(String(16), default="in_progress")
    order_json = Column(Text, default="[]")
    started_at = Column(DateTime, default=datetime.utcnow)
    submitted_at = Column(DateTime)
    graded_at = Column(DateTime)
    graded_by = Column(Integer)
    objective_score = Column(Float, default=0.0)
    subjective_score = Column(Float, default=0.0)
    total_score = Column(Float, default=0.0)
    full_score = Column(Float, default=0.0)
    passed = Column(Boolean, default=False)
    comment = Column(Text, default="")


class ExAnswer(Base):
    __tablename__ = "ex_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_ex_answer"),)
    id = Column(Integer, primary_key=True)
    attempt_id = Column(Integer, ForeignKey("ex_attempts.id", ondelete="CASCADE"), index=True)
    question_id = Column(Integer, index=True)
    answer = Column(Text, default="")
    score = Column(Float)
    is_correct = Column(Boolean)
    comment = Column(Text, default="")
    graded_by = Column(Integer)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


Base.metadata.create_all(bind=engine)


# --------------------------------------------------------------------- 工具
def _now():
    return datetime.utcnow()


def _iso(dt):
    return dt.isoformat() + "Z" if dt else None


def _json(text, default):
    try:
        value = json.loads(text or "")
        return default if value is None else value
    except Exception:
        return default


def _dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "").replace("T", " ").split(".")[0])
    except Exception:
        return None


def _paper(db: Session, exam_id: int):
    """试卷题目：统一返回 [(ExQuestion, ExPaperItem)]（注意元组顺序，两端都按这个来）"""
    return (db.query(ExQuestion, ExPaperItem)
              .join(ExPaperItem, ExPaperItem.question_id == ExQuestion.id)
              .filter(ExPaperItem.exam_id == exam_id)
              .order_by(ExPaperItem.order_no.asc(), ExPaperItem.id.asc())
              .all())


def _full(db: Session, exam_id: int) -> float:
    return float(sum((item.score or 0) for _q, item in _paper(db, exam_id)))


def _left(attempt: ExAttempt, exam: ExExam) -> int:
    if not exam.duration_min:
        return -1
    end = attempt.started_at + timedelta(minutes=int(exam.duration_min))
    return int((end - _now()).total_seconds())


def _open(exam: ExExam) -> bool:
    if exam.status != "published":
        return False
    if exam.start_at and _now() < exam.start_at:
        return False
    if exam.end_at and _now() > exam.end_at:
        return False
    return True


def _allowed(db: Session, exam: ExExam, user) -> bool:
    rows = db.query(ExStudent).filter(ExStudent.exam_id == exam.id).all()
    return True if not rows else any(r.user_id == user.id for r in rows)


def _judge(q: ExQuestion, raw: str):
    given, right = (raw or "").strip(), (q.answer or "").strip()
    if q.qtype == "single":
        return given.upper() == right.upper()
    if q.qtype == "multiple":
        a = {x.strip().upper() for x in given.replace("，", ",").split(",") if x.strip()}
        b = {x.strip().upper() for x in right.replace("，", ",").split(",") if x.strip()}
        return bool(b) and a == b
    if q.qtype == "judge":
        norm = {"t": "对", "true": "对", "1": "对", "y": "对", "对": "对", "正确": "对",
                "f": "错", "false": "错", "0": "错", "n": "错", "错": "错", "错误": "错"}
        return norm.get(given.lower(), given) == norm.get(right.lower(), right)
    if q.qtype == "fill":
        return any(given.lower() == x.strip().lower() for x in right.split("|") if x.strip())
    return None


def _qview(q: ExQuestion, score: float, order_no: int, with_answer: bool):
    data = {"id": q.id, "order_no": order_no, "qtype": q.qtype, "stem": q.stem,
            "options": _json(q.options, []), "score": score,
            "category": q.category, "difficulty": q.difficulty}
    if with_answer:
        data["answer"] = q.answer
        data["analysis"] = q.analysis
    return data


def _attempt_view(db: Session, attempt: ExAttempt, exam: ExExam, with_answer: bool):
    ids = _json(attempt.order_json, [])
    questions = {q.id: q for q in db.query(ExQuestion).filter(ExQuestion.id.in_(ids or [0])).all()}
    items = {i.question_id: i for _q, i in _paper(db, exam.id)}
    answers = {a.question_id: a for a in db.query(ExAnswer).filter(ExAnswer.attempt_id == attempt.id).all()}
    out = []
    for idx, qid in enumerate(ids):
        q, item = questions.get(qid), items.get(qid)
        if not q:
            continue
        view = _qview(q, float(item.score if item else q.score), idx + 1, with_answer)
        mine = answers.get(qid)
        view["my_answer"] = mine.answer if mine else ""
        if with_answer:
            view["my_score"] = mine.score if mine else None
            view["my_comment"] = mine.comment if mine else ""
        out.append(view)
    return {
        "attempt_id": attempt.id,
        "exam": {"id": exam.id, "title": exam.title, "description": exam.description,
                 "duration_min": exam.duration_min, "full_score": _full(db, exam.id),
                 "pass_score": exam.pass_score, "show_analysis": bool(exam.show_analysis)},
        "status": attempt.status, "remaining_seconds": _left(attempt, exam),
        "started_at": _iso(attempt.started_at), "submitted_at": _iso(attempt.submitted_at),
        "comment": attempt.comment, "total_score": attempt.total_score,
        "objective_score": attempt.objective_score, "subjective_score": attempt.subjective_score,
        "full_score": attempt.full_score, "passed": attempt.passed,
        "questions": out,
    }


def _refresh(db: Session, attempt: ExAttempt):
    exam = db.get(ExExam, attempt.exam_id)
    rows = db.query(ExAnswer).filter(ExAnswer.attempt_id == attempt.id).all()
    qmap = {q.id: q for q in db.query(ExQuestion).filter(
        ExQuestion.id.in_([r.question_id for r in rows] or [0])).all()}
    manual_left = [r for r in rows if r.score is None and (qmap.get(r.question_id) or ExQuestion()).qtype == "short"]
    objective = sum((r.score or 0) for r in rows if r.score is not None
                    and (qmap.get(r.question_id) or ExQuestion()).qtype != "short")
    subjective = sum((r.score or 0) for r in rows if r.score is not None
                     and (qmap.get(r.question_id) or ExQuestion()).qtype == "short")
    attempt.objective_score = round(objective, 2)
    attempt.subjective_score = round(subjective, 2)
    attempt.total_score = round(objective + subjective, 2)
    attempt.full_score = _full(db, attempt.exam_id)
    attempt.passed = bool(attempt.full_score and attempt.total_score >= float(exam.pass_score or 0))
    if attempt.submitted_at:
        attempt.status = "submitted" if manual_left else "graded"
    return attempt


# --------------------------------------------------------------------- 考生端
@student.get("/list")
def exam_list(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = (db.query(ExExam).filter(ExExam.status.in_(("published", "closed")))
              .order_by(ExExam.created_at.desc()).all())
    mine = {a.exam_id: a for a in db.query(ExAttempt).filter(ExAttempt.user_id == user.id).all()}
    items = []
    for exam in rows:
        if not _allowed(db, exam, user):
            continue
        attempt = mine.get(exam.id)
        items.append({
            "id": exam.id, "title": exam.title, "description": exam.description,
            "status": exam.status, "open": _open(exam),
            "start_at": _iso(exam.start_at), "end_at": _iso(exam.end_at),
            "duration_min": exam.duration_min, "pass_score": exam.pass_score,
            "full_score": _full(db, exam.id),
            "question_count": db.query(ExPaperItem).filter(ExPaperItem.exam_id == exam.id).count(),
            "my": None if not attempt else {
                "attempt_id": attempt.id, "status": attempt.status,
                "score": attempt.total_score if attempt.status == "graded" else None,
                "objective_score": attempt.objective_score, "passed": attempt.passed,
                "submitted_at": _iso(attempt.submitted_at),
                "pending_manual": attempt.status == "submitted",
            },
        })
    return {"items": items}


@student.get("/my")
def my_records(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = (db.query(ExAttempt, ExExam).join(ExExam, ExExam.id == ExAttempt.exam_id)
              .filter(ExAttempt.user_id == user.id).order_by(ExAttempt.started_at.desc()).all())
    return {"items": [{
        "attempt_id": a.id, "exam_id": e.id, "exam_title": e.title, "status": a.status,
        "score": a.total_score, "objective_score": a.objective_score,
        "subjective_score": a.subjective_score, "full_score": a.full_score, "passed": a.passed,
        "started_at": _iso(a.started_at), "submitted_at": _iso(a.submitted_at),
    } for a, e in rows]}


@student.post("/{exam_id}/start")
def exam_start(exam_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    exam = db.get(ExExam, exam_id)
    if not exam or exam.status == "draft":
        raise HTTPException(404, "考试不存在")
    if not _open(exam):
        raise HTTPException(400, "不在考试时间内")
    if not _allowed(db, exam, user):
        raise HTTPException(403, "你不在本场考试名单里")
    attempt = db.query(ExAttempt).filter(ExAttempt.exam_id == exam_id,
                                         ExAttempt.user_id == user.id).first()
    if attempt:
        return _attempt_view(db, attempt, exam, with_answer=attempt.status != "in_progress")
    items = _paper(db, exam_id)
    if not items:
        raise HTTPException(400, "本场考试还没有题目")
    ids = [q.id for q, _i in items]
    if exam.shuffle:
        random.shuffle(ids)
    attempt = ExAttempt(exam_id=exam_id, user_id=user.id, order_json=json.dumps(ids),
                        full_score=_full(db, exam_id))
    db.add(attempt)
    db.flush()
    for qid in ids:
        db.add(ExAnswer(attempt_id=attempt.id, question_id=qid, answer=""))
    db.commit()
    return _attempt_view(db, attempt, exam, with_answer=False)


@student.get("/attempts/{aid}")
def attempt_get(aid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    attempt = db.get(ExAttempt, aid)
    if not attempt or (attempt.user_id != user.id and getattr(user, "role", "") != "admin"):
        raise HTTPException(404, "答卷不存在")
    exam = db.get(ExExam, attempt.exam_id)
    return _attempt_view(db, attempt, exam,
                         with_answer=attempt.status != "in_progress" or bool(exam.show_analysis))


@student.patch("/attempts/{aid}")
def attempt_save(aid: int, body: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    attempt = db.get(ExAttempt, aid)
    if not attempt or attempt.user_id != user.id:
        raise HTTPException(404, "答卷不存在")
    if attempt.status != "in_progress":
        raise HTTPException(400, "已交卷，不能再修改")
    exam = db.get(ExExam, attempt.exam_id)
    if exam.duration_min and _left(attempt, exam) <= 0:
        raise HTTPException(400, "考试时间已结束")
    for qid, value in (body.get("answers") or {}).items():
        row = db.query(ExAnswer).filter(ExAnswer.attempt_id == aid,
                                        ExAnswer.question_id == int(qid)).first()
        if row:
            row.answer = (value or "")[:4000]
    db.commit()
    return {"ok": True, "remaining_seconds": _left(attempt, exam)}


@student.post("/attempts/{aid}/submit")
def attempt_submit(aid: int, body: dict = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    attempt = db.get(ExAttempt, aid)
    if not attempt or attempt.user_id != user.id:
        raise HTTPException(404, "答卷不存在")
    if attempt.status != "in_progress":
        return {"ok": True, "already": True, "status": attempt.status}
    exam = db.get(ExExam, attempt.exam_id)
    for qid, value in ((body or {}).get("answers") or {}).items():
        row = db.query(ExAnswer).filter(ExAnswer.attempt_id == aid,
                                        ExAnswer.question_id == int(qid)).first()
        if row:
            row.answer = (value or "")[:4000]
    items = {i.question_id: i for _q, i in _paper(db, exam.id)}
    qmap = {q.id: q for q, _i in _paper(db, exam.id)}
    for row in db.query(ExAnswer).filter(ExAnswer.attempt_id == aid).all():
        q = qmap.get(row.question_id)
        if not q:
            continue
        verdict = _judge(q, row.answer)
        if verdict is None:
            row.score, row.is_correct = None, None
        else:
            row.score = float(items[row.question_id].score) if verdict else 0.0
            row.is_correct = bool(verdict)
    attempt.submitted_at = _now()
    _refresh(db, attempt)
    db.commit()
    return {"ok": True, "attempt_id": attempt.id, "objective_score": attempt.objective_score,
            "status": attempt.status}


@student.get("/attempts/{aid}/result")
def attempt_result(aid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    attempt = db.get(ExAttempt, aid)
    if not attempt or (attempt.user_id != user.id and getattr(user, "role", "") != "admin"):
        raise HTTPException(404, "答卷不存在")
    exam = db.get(ExExam, attempt.exam_id)
    if attempt.user_id == user.id and not exam.show_result and attempt.status != "graded":
        raise HTTPException(403, "成绩暂未公布")
    return _attempt_view(db, attempt, exam,
                         with_answer=bool(exam.show_analysis) or attempt.status == "graded")


# --------------------------------------------------------------------- 管理端 · 题库
class QuestionIn(BaseModel):
    qtype: str = "single"
    stem: str
    options: list = []
    answer: str = ""
    analysis: str = ""
    score: float = 5.0
    difficulty: int = 1
    category: str = ""


def _validate(body: QuestionIn):
    if body.qtype not in QTYPES:
        raise HTTPException(400, "题型不合法")
    if not (body.stem or "").strip():
        raise HTTPException(400, "题干不能为空")
    if body.qtype in ("single", "multiple") and not body.options:
        raise HTTPException(400, "选择题必须给选项")
    if body.qtype in OBJECTIVE and not (body.answer or "").strip():
        raise HTTPException(400, "客观题必须给答案")


@admin.get("/questions")
def questions(q: str = "", qtype: str = "", limit: int = 50, skip: int = 0,
              db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    query = db.query(ExQuestion)
    if q:
        query = query.filter(ExQuestion.stem.like(f"%{q}%"))
    if qtype:
        query = query.filter(ExQuestion.qtype == qtype)
    rows = query.order_by(ExQuestion.id.desc()).offset(max(0, skip)).limit(min(200, max(1, limit))).all()
    return {"total": query.count(), "items": [_qview(x, x.score, 0, True) for x in rows]}


@admin.post("/questions")
def question_create(body: QuestionIn, db: Session = Depends(get_db), admin_user=Depends(get_current_admin)):
    _validate(body)
    row = ExQuestion(qtype=body.qtype, stem=body.stem.strip(),
                     options=json.dumps(body.options, ensure_ascii=False),
                     answer=(body.answer or "").strip(), analysis=body.analysis or "",
                     score=float(body.score or 0), difficulty=int(body.difficulty or 1),
                     category=body.category or "", created_by=admin_user.id)
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@admin.put("/questions/{qid}")
def question_update(qid: int, body: QuestionIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    row = db.get(ExQuestion, qid)
    if not row:
        raise HTTPException(404, "题目不存在")
    _validate(body)
    row.qtype, row.stem = body.qtype, body.stem.strip()
    row.options = json.dumps(body.options, ensure_ascii=False)
    row.answer = (body.answer or "").strip()
    row.analysis = body.analysis or ""
    row.score = float(body.score or 0)
    row.difficulty = int(body.difficulty or 1)
    row.category = body.category or ""
    db.commit()
    return {"ok": True}


@admin.delete("/questions/{qid}")
def question_delete(qid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    row = db.get(ExQuestion, qid)
    if not row:
        raise HTTPException(404, "题目不存在")
    used = db.query(ExPaperItem).filter(ExPaperItem.question_id == qid).count()
    if used:
        raise HTTPException(400, f"该题已被 {used} 场考试使用，先从试卷里移除")
    db.delete(row)
    db.commit()
    return {"ok": True}


@admin.post("/questions/import")
def questions_import(body: dict, db: Session = Depends(get_db), admin_user=Depends(get_current_admin)):
    ok, errors = 0, []
    for idx, raw in enumerate(body.get("items") or []):
        try:
            qtype = (raw.get("qtype") or "single").strip()
            if qtype not in QTYPES:
                raise ValueError("题型不合法")
            if not (raw.get("stem") or "").strip():
                raise ValueError("题干为空")
            opts = raw.get("options") or []
            if isinstance(opts, str):
                opts = [{"key": chr(65 + n), "text": s.strip()}
                        for n, s in enumerate(opts.split("|")) if s.strip()]
            if qtype in ("single", "multiple") and not opts:
                raise ValueError("选择题必须给选项")
            if qtype in OBJECTIVE and not str(raw.get("answer") or "").strip():
                raise ValueError("客观题必须给答案")
            db.add(ExQuestion(qtype=qtype, stem=str(raw["stem"]).strip(),
                              options=json.dumps(opts, ensure_ascii=False),
                              answer=str(raw.get("answer") or "").strip(),
                              analysis=raw.get("analysis") or "", score=float(raw.get("score") or 5),
                              difficulty=int(raw.get("difficulty") or 1),
                              category=raw.get("category") or "", created_by=admin_user.id))
            ok += 1
        except Exception as exc:
            errors.append({"index": idx, "error": str(exc)})
    db.commit()
    return {"ok": True, "imported": ok, "errors": errors}


# --------------------------------------------------------------------- 管理端 · 考试
class ExamIn(BaseModel):
    title: str
    description: str = ""
    start_at: str = ""
    end_at: str = ""
    duration_min: int = 0
    pass_score: float = 60.0
    shuffle: bool = False
    show_result: bool = True
    show_analysis: bool = False


def _eview(db: Session, exam: ExExam):
    return {
        "id": exam.id, "title": exam.title, "description": exam.description, "status": exam.status,
        "start_at": _iso(exam.start_at), "end_at": _iso(exam.end_at),
        "duration_min": exam.duration_min, "pass_score": exam.pass_score, "shuffle": exam.shuffle,
        "show_result": exam.show_result, "show_analysis": exam.show_analysis,
        "full_score": _full(db, exam.id),
        "question_count": db.query(ExPaperItem).filter(ExPaperItem.exam_id == exam.id).count(),
        "attempt_count": db.query(ExAttempt).filter(ExAttempt.exam_id == exam.id).count(),
        "created_at": _iso(exam.created_at),
    }


@admin.get("/exams")
def exams(status: str = "", q: str = "", limit: int = 50, skip: int = 0,
          db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    query = db.query(ExExam)
    if status:
        query = query.filter(ExExam.status == status)
    if q:
        query = query.filter(ExExam.title.like(f"%{q}%"))
    rows = query.order_by(ExExam.id.desc()).offset(max(0, skip)).limit(min(200, max(1, limit))).all()
    return {"total": query.count(), "items": [_eview(db, e) for e in rows]}


@admin.post("/exams")
def exam_create(body: ExamIn, db: Session = Depends(get_db), admin_user=Depends(get_current_admin)):
    if not (body.title or "").strip():
        raise HTTPException(400, "考试名称不能为空")
    exam = ExExam(title=body.title.strip(), description=body.description or "",
                  start_at=_dt(body.start_at), end_at=_dt(body.end_at),
                  duration_min=int(body.duration_min or 0), pass_score=float(body.pass_score or 0),
                  shuffle=bool(body.shuffle), show_result=bool(body.show_result),
                  show_analysis=bool(body.show_analysis), created_by=admin_user.id, status="draft")
    db.add(exam)
    db.commit()
    return {"ok": True, "id": exam.id}


@admin.put("/exams/{eid}")
def exam_update(eid: int, body: ExamIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    exam = db.get(ExExam, eid)
    if not exam:
        raise HTTPException(404, "考试不存在")
    if not (body.title or "").strip():
        raise HTTPException(400, "考试名称不能为空")
    exam.title = body.title.strip()
    exam.description = body.description or ""
    exam.start_at, exam.end_at = _dt(body.start_at), _dt(body.end_at)
    exam.duration_min = int(body.duration_min or 0)
    exam.pass_score = float(body.pass_score or 0)
    exam.shuffle = bool(body.shuffle)
    exam.show_result = bool(body.show_result)
    exam.show_analysis = bool(body.show_analysis)
    db.commit()
    return {"ok": True}


@admin.delete("/exams/{eid}")
def exam_delete(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    exam = db.get(ExExam, eid)
    if not exam:
        raise HTTPException(404, "考试不存在")
    n = db.query(ExAttempt).filter(ExAttempt.exam_id == eid).count()
    if n:
        raise HTTPException(400, f"已有 {n} 份答卷，不能删除；可以先「截止」")
    db.query(ExPaperItem).filter(ExPaperItem.exam_id == eid).delete()
    db.query(ExStudent).filter(ExStudent.exam_id == eid).delete()
    db.delete(exam)
    db.commit()
    return {"ok": True}


@admin.get("/exams/{eid}/paper")
def paper_get(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    if not db.get(ExExam, eid):
        raise HTTPException(404, "考试不存在")
    return {"items": [_qview(q, float(i.score), i.order_no, True) for q, i in _paper(db, eid)],
            "full_score": _full(db, eid)}


@admin.put("/exams/{eid}/paper")
def paper_set(eid: int, body: dict, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    if not db.get(ExExam, eid):
        raise HTTPException(404, "考试不存在")
    items = body.get("items") or []
    db.query(ExPaperItem).filter(ExPaperItem.exam_id == eid).delete()
    for idx, raw in enumerate(items):
        qid = int(raw.get("question_id"))
        if not db.get(ExQuestion, qid):
            raise HTTPException(400, f"题目 {qid} 不存在")
        db.add(ExPaperItem(exam_id=eid, question_id=qid,
                           order_no=int(raw.get("order_no") or idx + 1),
                           score=float(raw.get("score") or 5)))
    db.commit()
    return {"ok": True, "count": len(items), "full_score": _full(db, eid)}


@admin.post("/exams/{eid}/publish")
def exam_publish(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    exam = db.get(ExExam, eid)
    if not exam:
        raise HTTPException(404, "考试不存在")
    if not db.query(ExPaperItem).filter(ExPaperItem.exam_id == eid).count():
        raise HTTPException(400, "还没有题目，不能发布")
    exam.status = "published"
    db.commit()
    return {"ok": True, "status": exam.status}


@admin.post("/exams/{eid}/close")
def exam_close(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    exam = db.get(ExExam, eid)
    if not exam:
        raise HTTPException(404, "考试不存在")
    exam.status = "closed"
    db.commit()
    return {"ok": True, "status": exam.status}


@admin.get("/exams/{eid}/students")
def students_get(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return {"items": [{"user_id": r.user_id}
                      for r in db.query(ExStudent).filter(ExStudent.exam_id == eid).all()]}


@admin.post("/exams/{eid}/students")
def students_set(eid: int, body: dict, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    if not db.get(ExExam, eid):
        raise HTTPException(404, "考试不存在")
    ids = [int(x) for x in (body.get("user_ids") or [])]
    db.query(ExStudent).filter(ExStudent.exam_id == eid).delete()
    for uid in ids:
        db.add(ExStudent(exam_id=eid, user_id=uid))
    db.commit()
    return {"ok": True, "count": len(ids)}


@admin.get("/exams/{eid}/attempts")
def attempts_of_exam(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    rows = (db.query(ExAttempt).filter(ExAttempt.exam_id == eid)
              .order_by(ExAttempt.total_score.desc(), ExAttempt.submitted_at.asc()).all())
    return {"items": [{
        "attempt_id": a.id, "user_id": a.user_id, "status": a.status,
        "objective_score": a.objective_score, "subjective_score": a.subjective_score,
        "score": a.total_score, "full_score": a.full_score, "passed": a.passed,
        "started_at": _iso(a.started_at), "submitted_at": _iso(a.submitted_at),
    } for a in rows]}


@admin.get("/grading")
def grading(exam_id: int = 0, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    query = db.query(ExAttempt).filter(ExAttempt.status == "submitted")
    if exam_id:
        query = query.filter(ExAttempt.exam_id == exam_id)
    rows = query.order_by(ExAttempt.submitted_at.asc()).limit(300).all()
    exams_map = {e.id: e for e in db.query(ExExam).filter(
        ExExam.id.in_([a.exam_id for a in rows] or [0])).all()}
    return {"items": [{
        "attempt_id": a.id, "exam_id": a.exam_id,
        "exam_title": exams_map[a.exam_id].title if a.exam_id in exams_map else "",
        "user_id": a.user_id, "submitted_at": _iso(a.submitted_at),
        "objective_score": a.objective_score,
    } for a in rows]}


@admin.get("/attempts/{aid}")
def attempt_detail(aid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    attempt = db.get(ExAttempt, aid)
    if not attempt:
        raise HTTPException(404, "答卷不存在")
    exam = db.get(ExExam, attempt.exam_id)
    data = _attempt_view(db, attempt, exam, with_answer=True)
    data["user_id"] = attempt.user_id
    return data


@admin.post("/attempts/{aid}/grade")
def attempt_grade(aid: int, body: dict, db: Session = Depends(get_db), admin_user=Depends(get_current_admin)):
    attempt = db.get(ExAttempt, aid)
    if not attempt:
        raise HTTPException(404, "答卷不存在")
    scores = body.get("scores") or {}
    comments = body.get("comments") or {}
    for qid, value in scores.items():
        row = db.query(ExAnswer).filter(ExAnswer.attempt_id == aid,
                                        ExAnswer.question_id == int(qid)).first()
        if not row:
            continue
        item = db.query(ExPaperItem).filter(ExPaperItem.exam_id == attempt.exam_id,
                                            ExPaperItem.question_id == int(qid)).first()
        cap = float(item.score if item else 0)
        row.score = max(0.0, min(float(value or 0), cap))
        row.graded_by = admin_user.id
        row.updated_at = _now()
        note = comments.get(str(qid), comments.get(int(qid) if str(qid).isdigit() else qid))
        if note is not None:
            row.comment = str(note)[:500]
    if "comment" in body:
        attempt.comment = str(body.get("comment") or "")[:1000]
    attempt.graded_by = admin_user.id
    attempt.graded_at = _now()
    _refresh(db, attempt)
    db.commit()
    return {"ok": True, "total_score": attempt.total_score, "status": attempt.status,
            "passed": attempt.passed}


@admin.post("/attempts/{aid}/reset")
def attempt_reset(aid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    attempt = db.get(ExAttempt, aid)
    if not attempt:
        raise HTTPException(404, "答卷不存在")
    db.query(ExAnswer).filter(ExAnswer.attempt_id == aid).delete()
    db.delete(attempt)
    db.commit()
    return {"ok": True}


@admin.get("/exams/{eid}/stats")
def exam_stats(eid: int, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    exam = db.get(ExExam, eid)
    if not exam:
        raise HTTPException(404, "考试不存在")
    attempts = db.query(ExAttempt).filter(ExAttempt.exam_id == eid,
                                          ExAttempt.status.in_(("submitted", "graded"))).all()
    total = _full(db, eid)
    scores = [a.total_score or 0 for a in attempts]
    passed = [s for s in scores if total and s >= float(exam.pass_score or 0)]
    buckets = {"0-59%": 0, "60-69%": 0, "70-79%": 0, "80-89%": 0, "90-100%": 0}
    for s in scores:
        pct = (s / total * 100) if total else 0
        key = ("0-59%" if pct < 60 else "60-69%" if pct < 70 else "70-79%" if pct < 80
               else "80-89%" if pct < 90 else "90-100%")
        buckets[key] += 1
    per_question = []
    for q, item in _paper(db, eid):
        rows = (db.query(ExAnswer).join(ExAttempt, ExAttempt.id == ExAnswer.attempt_id)
                  .filter(ExAttempt.exam_id == eid, ExAnswer.question_id == q.id).all())
        graded = [r for r in rows if r.score is not None]
        per_question.append({
            "question_id": q.id, "order_no": item.order_no, "qtype": q.qtype,
            "stem": (q.stem or "")[:60], "full": float(item.score or 0),
            "answered": len([r for r in rows if (r.answer or "").strip()]),
            "graded": len(graded),
            "avg_score": round(sum((r.score or 0) for r in graded) / len(graded), 2) if graded else 0,
            "correct_rate": (round(len([r for r in graded if r.is_correct]) / len(graded) * 100, 1)
                             if graded and q.qtype in OBJECTIVE else None),
        })
    return {
        "exam_id": eid, "title": exam.title, "status": exam.status,
        "full_score": total, "pass_score": exam.pass_score,
        "attempts": len(attempts), "graded": len([a for a in attempts if a.status == "graded"]),
        "avg_score": round(sum(scores) / len(scores), 2) if scores else 0,
        "max_score": max(scores) if scores else 0, "min_score": min(scores) if scores else 0,
        "pass_count": len(passed),
        "pass_rate": round(len(passed) / len(scores) * 100, 1) if scores else 0,
        "distribution": buckets, "per_question": per_question,
    }
