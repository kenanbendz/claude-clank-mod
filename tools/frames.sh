#!/bin/sh
# Renders the Clank webm clips (VP9 with alpha) into the mod's PNG frames and the README GIFs.
# usage: tools/frames.sh <dir holding clank_<mood>.webm>   (run from the mod's folder)
set -e
SRC=${1:?dir holding clank_*.webm}
# one crop for every clip (the union of their alpha bounding boxes), so Clank never jumps between moods
CROP=1046:714:234:0
FPS=20
HEIGHT=176
CHAIN="fps=$FPS,crop=$CROP,scale=-2:$HEIGHT:flags=lanczos,format=rgba,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:alpha_threshold=128"
for clip in celebrate:celebrating error reading sleeping thinking typing waiting working; do
  name=${clip%%:*}; mood=${clip#*:}
  rm -rf "frames/$mood"; mkdir -p "frames/$mood" assets
  ffmpeg -y -v error -c:v libvpx-vp9 -i "$SRC/clank_$name.webm" -filter_complex "$CHAIN" -start_number 0 "frames/$mood/%04d.png"
  ffmpeg -y -v error -c:v libvpx-vp9 -i "$SRC/clank_$name.webm" -filter_complex "$CHAIN" -loop 0 "assets/$mood.gif"
  echo "$mood: $(ls frames/$mood | wc -l | tr -d ' ') frames"
done
