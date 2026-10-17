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
    candidates = [
        os.path.join(root_dir, "SPYNEX", "backend"),
        os.path.join(root_dir, "ringtrace", "backend"),
        os.path.join(root_dir, "backend"),
        root_dir,
    ]
    backend_dir = next(
        (candidate for candidate in candidates if os.path.isdir(os.path.join(candidate, "tests"))),
        root_dir,
    )
    tests_dir = os.path.join(backend_dir, "tests")

    venv_py = os.path.join(backend_dir, ".venv", "Scripts", "python.exe")
    if not os.path.isfile(venv_py):
        venv_py = os.path.join(backend_dir, ".venv", "bin", "python")
    if os.path.isfile(venv_py) and os.path.abspath(sys.executable).lower() != os.path.abspath(venv_py).lower():
        try:
            import falkordb  # noqa: F401
        except ImportError:
            import subprocess
            res = subprocess.run([venv_py, os.path.abspath(__file__)] + sys.argv[1:])
            sys.exit(res.returncode)

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
