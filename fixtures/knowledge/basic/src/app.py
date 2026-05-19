import os


class Runner:
    def run(self) -> str:
        return hello()


def hello() -> str:
    return os.getcwd()
