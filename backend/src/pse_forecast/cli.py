"""Command line entry point: `python -m pse_forecast.cli <command>`.

refresh   download new PSE demand and weather data
train     train, evaluate and register a model (offline, on the author's machine)
"""

import argparse
import json
import logging
import sys


def _print(result: dict) -> None:
    print(json.dumps(result, indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="pse_forecast")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("refresh", help="download new PSE demand and weather data")
    train_p = sub.add_parser("train", help="train, evaluate and register the model")
    train_p.add_argument("--test-days", type=int, default=None)
    args = parser.parse_args(argv)

    if args.command == "refresh":
        from pse_forecast.pipeline import refresh

        result = refresh()
        _print(result)
        if result["status"] == "failed":
            return 1
    if args.command == "train":
        from pse_forecast.training import train

        _print(train(test_days=args.test_days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
