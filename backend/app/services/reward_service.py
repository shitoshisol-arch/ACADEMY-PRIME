from decimal import Decimal
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.content import Video
from app.models.enums import RewardEntryType, RewardStatus
from app.models.progress import VideoCompletion
from app.models.reward import Reward as RewardLedger
from app.models.reward import RewardSettings


def get_reward_settings(db: Session) -> RewardSettings:
    row = db.get(RewardSettings, 1)
    if row is None:
        row = RewardSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


COURSE_REWARD_MIN_SECONDS = 180   # 3 minutes
COURSE_REWARD_MAX_SECONDS = 900   # 15 minutes
COURSE_REWARD_MIN = Decimal("0.005")
COURSE_REWARD_MAX = Decimal("0.05")


def duration_based_reward(duration_seconds: int | None) -> Decimal:
    """Tiered course reward: <=3min -> 0.005, >=15min -> 0.05, linear between."""
    seconds = int(duration_seconds or 0)
    if seconds <= COURSE_REWARD_MIN_SECONDS:
        return COURSE_REWARD_MIN
    if seconds >= COURSE_REWARD_MAX_SECONDS:
        return COURSE_REWARD_MAX
    fraction = Decimal(seconds - COURSE_REWARD_MIN_SECONDS) / Decimal(
        COURSE_REWARD_MAX_SECONDS - COURSE_REWARD_MIN_SECONDS
    )
    return (COURSE_REWARD_MIN + (COURSE_REWARD_MAX - COURSE_REWARD_MIN) * fraction).quantize(
        Decimal("0.000001")
    )


def is_course_video(video: Video) -> bool:
    """A lesson belonging to a tagged course playlist."""
    import re

    for raw in video.tags or []:
        tag = str(raw)
        if not re.fullmatch(r"[a-z0-9-]+", tag):
            continue
        if tag.startswith(("module-", "wistia-", "author-")):
            continue
        if tag in {"course", "blockchain", "bitcoin"}:
            continue
        return True
    return False


def effective_video_reward(db: Session, video: Video) -> Decimal:
    if is_course_video(video):
        return duration_based_reward(video.duration_seconds)
    if video.reward_amount is not None:
        return video.reward_amount
    settings = get_reward_settings(db)
    return settings.default_video_reward


def issue_completion_reward(
    db: Session,
    user_id: UUID,
    completion: VideoCompletion,
    video: Video,
) -> RewardLedger | None:
    amount = effective_video_reward(db, video)
    if amount <= 0:
        return None
    settings = get_settings()
    entry = RewardLedger(
        user_id=user_id,
        entry_type=RewardEntryType.VIDEO_COMPLETION,
        source_type="video_completion",
        source_id=completion.id,
        video_id=video.id,
        completion_id=completion.id,
        amount=amount,
        token_mint=settings.TOKEN_MINT,
        token_decimals=settings.TOKEN_DECIMALS,
        status=RewardStatus.AVAILABLE,
    )
    db.add(entry)
    try:
        db.commit()
        db.refresh(entry)
        return entry
    except IntegrityError:
        db.rollback()
        return None
