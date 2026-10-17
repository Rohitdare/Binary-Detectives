"""RingTrace Unified Test Runner.

Executes the complete RingTrace backend test suite (all 23 test suites, 214+ tests)
from either the repository root or the backend directory.

Usage:
    python run_tests.py
    python run_tests.py -v
"""
import os
import sys
import unittest


def run_all_tests():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "ringtrace", "backend")
    tests_dir = os.path.join(backend_dir, "tests")

    if not os.path.isdir(tests_dir):
        # Running from inside ringtrace/backend
        backend_dir = root_dir
        tests_dir = os.path.join(backend_dir, "tests")

    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)

    os.environ.setdefault("FALKORDB_GRAPH", "txn")
    os.environ.setdefault("FALKORDB_MEMORY_GRAPH", "memory")

    orig_cwd = os.getcwd()
    os.chdir(backend_dir)
    try:
        verbosity = 2 if "-v" in sys.argv or "--verbose" in sys.argv else 1
        loader = unittest.TestLoader()
        suite = loader.discover("tests")
        runner = unittest.TextTestRunner(verbosity=verbosity)
        result = runner.run(suite)
        sys.exit(0 if result.wasSuccessful() else 1)
    finally:
        os.chdir(orig_cwd)


if __name__ == "__main__":
    run_all_tests()
