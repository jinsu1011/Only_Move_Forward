import sys

import serial
import ursina


print(f"Python: {sys.version.split()[0]}")
print(f"pyserial: {serial.VERSION}")
print(f"Ursina import: OK ({ursina.__file__})")
print("PHASE 1 PYTHON SETUP: OK")
