import os
import pkgutil
import importlib
import traceback
import sys

def check_imports(package_name):
    package = importlib.import_module(package_name)
    failed = False
    for _, name, is_pkg in pkgutil.walk_packages(package.__path__, package.__name__ + '.'):
        try:
            importlib.import_module(name)
            print(f"OK: {name}")
        except Exception as e:
            print(f"FAIL: {name}")
            traceback.print_exc()
            failed = True
    if failed:
        sys.exit(1)
    else:
        print("ALL IMPORTS OK")
        sys.exit(0)

if __name__ == "__main__":
    check_imports('app')
