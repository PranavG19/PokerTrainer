#!/bin/sh
# Poll AeroSpace while a test run is in progress: log the focused workspace/app, and any Electron window
# that AeroSpace can see (a hidden-mode run must log none). Usage: scripts/focus-watch.sh <logfile> &
log="${1:-focus-watch.log}"
: > "$log"
while :; do
  ts=$(date +%H:%M:%S)
  ws=$(aerospace list-workspaces --focused 2>/dev/null)
  app=$(aerospace list-windows --focused --format '%{app-name}' 2>/dev/null)
  electron=$(aerospace list-windows --all --format '%{window-id}|%{app-name}|%{workspace}' 2>/dev/null | grep -i 'electron\|offsuit')
  echo "$ts ws=$ws app=$app electron=[${electron}]" >> "$log"
  sleep 0.5
done
