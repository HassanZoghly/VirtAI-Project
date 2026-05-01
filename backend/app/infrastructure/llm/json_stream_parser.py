"""
A lightweight streaming JSON parser that extracts string values on the fly.
It processes raw token chunks and yields characters for specific string fields.
"""



class JsonStreamParser:
    def __init__(self):
        self.state = "WAIT_KEY_START"
        self.current_key = ""
        self.in_escape = False

    def feed(self, token: str) -> list[tuple[str, str]]:
        """
        Feeds a chunk of raw JSON text.
        Returns a list of (key, character) pairs for currently parsed values.
        """
        emissions = []
        for char in token:
            if self.state == "WAIT_KEY_START":
                if char == '"':
                    self.state = "READING_KEY"
                    self.current_key = ""
            elif self.state == "READING_KEY":
                if char == '"':
                    self.state = "WAIT_COLON"
                else:
                    self.current_key += char
            elif self.state == "WAIT_COLON":
                if char == ':':
                    self.state = "WAIT_VALUE_START"
            elif self.state == "WAIT_VALUE_START":
                if char == '"':
                    self.state = "READING_VALUE"
                elif not char.isspace():
                    # If we encounter a boolean, number, or object `{`, this simple parser safely ignores it.
                    pass
            elif self.state == "READING_VALUE":
                if self.in_escape:
                    if char == 'n':
                        emissions.append((self.current_key, "\n"))
                    elif char == 't':
                        emissions.append((self.current_key, "\t"))
                    elif char == 'r':
                        emissions.append((self.current_key, "\r"))
                    elif char == '\\' or char == '"':
                        emissions.append((self.current_key, char))
                    else:
                        # For other escaped characters, just pass them
                        emissions.append((self.current_key, char))
                    self.in_escape = False
                elif char == '\\':
                    self.in_escape = True
                elif char == '"':
                    self.state = "WAIT_COMMA_OR_END"
                else:
                    emissions.append((self.current_key, char))
            elif self.state == "WAIT_COMMA_OR_END":
                if char == ',':
                    self.state = "WAIT_KEY_START"
                elif char == '}':
                    self.state = "DONE"
        return emissions
