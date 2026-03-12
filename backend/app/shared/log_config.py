import sys
from pathlib import Path

from loguru import logger

from app.shared.config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    logger.remove()
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    fmt = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{line}</cyan> | "
        "<cyan>{function}</cyan> | "
        "<magenta>PID:{process}</magenta> | "
        "<level>{message}</level>"
    )

    logger.add(
        sys.stdout,
        format=fmt,
        level="DEBUG" if settings.DEBUG else "INFO",
        colorize=True,
        backtrace=True,
        diagnose=settings.DEBUG,
    )

    logger.add(
        "logs/app_{time:YYYY-MM-DD}.log",
        format=fmt,
        level="DEBUG" if settings.DEBUG else "INFO",
        rotation="50 MB",
        retention="30 days",
        compression="gz",
        encoding="utf-8",
        enqueue=True,
        backtrace=True,
        diagnose=settings.DEBUG,
    )

    logger.add(
        "logs/errors_{time:YYYY-MM-DD}.log",
        format=fmt,
        level="ERROR",
        rotation="10 MB",
        retention="90 days",
        compression="gz",
        encoding="utf-8",
        enqueue=True,
        backtrace=True,
        diagnose=True,
    )

    if settings.ENVIRONMENT == "production":
        logger.add(
            "logs/json/app_{time:YYYY-MM-DD}.json",
            format="{time} | {level} | {message}",
            level="INFO",
            rotation="100 MB",
            retention="7 days",
            compression="gz",
            serialize=True,
            enqueue=True,
        )

    logger.configure(
        patcher=lambda record: (
            record["message"].replace(settings.GROQ_API_KEY, "[REDACTED]")
            if settings.GROQ_API_KEY in record["message"]
            else record
        )
    )

    logger.info(f"[*] Logging initialized | ENV: {settings.ENVIRONMENT}")
    logger.debug(f"Debug mode: {settings.DEBUG}")


def get_logger(module_name: str):
    return logger.bind(module=module_name)
