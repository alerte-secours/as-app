#!/usr/bin/env bash
exec adb -s $DEVICE exec-out screencap -p > screenshot-emulator-$(date +%s).png