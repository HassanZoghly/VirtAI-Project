import re

from app.shared.ids import parse_uuid


def is_safe_path_component(component: str) -> bool:
    if not component:
        return False
    if ".." in component or "/" in component or "\\" in component:
        return False
    return re.match(r"^[a-zA-Z0-9_-]+$", component) is not None


def is_valid_audio_message_id(message_id: str) -> bool:
    if not is_safe_path_component(message_id):
        return False

    base_id, separator, chunk_index = message_id.partition("_")
    if parse_uuid(base_id) is None:
        return False
    if separator and not chunk_index.isdigit():
        return False
    return True
