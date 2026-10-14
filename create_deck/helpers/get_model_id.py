"""
Helper for retrieving the notetype id a deck ships with.
"""

import hashlib


def get_model_id(name):
    """
    Preserve the old ids for backwards compatibility.
    :param name:
    :return:
    """
    if name == "n2a-input":
        return 6394002335189144856
    if name == "n2a-cloze":
        return 998877661
    if name == "n2a-basic":
        return 2020
    # https://stackoverflow.com/questions/16008670/how-to-hash-a-string-into-8-digits
    return abs(
        int(hashlib.sha1(name.encode("utf-8")).hexdigest(), 16) % (10 ** 8))
