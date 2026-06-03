"""テスト用画像 fixture を生成する。再生成: python3 src/test/gen-fixtures.py"""
import os
from PIL import Image

d = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(d, exist_ok=True)

# 8x8 赤 PNG（静止・メタデータ無し）
Image.new("RGB", (8, 8), (255, 0, 0)).save(os.path.join(d, "red.png"))

# 8x8 JPG に EXIF を埋め込む（master で除去されることの検証用）
img = Image.new("RGB", (8, 8), (0, 128, 255))
exif = Image.Exif()
exif[0x0132] = "2020:01:01 00:00:00"  # DateTime tag
img.save(os.path.join(d, "exif.jpg"), exif=exif)

# 8x8 静止 WebP
Image.new("RGB", (8, 8), (0, 255, 0)).save(os.path.join(d, "still.webp"))

# 2 フレームのアニメ WebP / GIF
f1 = Image.new("RGB", (8, 8), (255, 0, 0))
f2 = Image.new("RGB", (8, 8), (0, 0, 255))
f1.save(os.path.join(d, "anim.webp"), save_all=True, append_images=[f2], duration=100, loop=0)
f1.save(os.path.join(d, "anim.gif"), save_all=True, append_images=[f2], duration=100, loop=0)

# 非対応形式（テキスト）: 415 検証用
with open(os.path.join(d, "notimage.txt"), "wb") as fp:
    fp.write(b"this is not an image")

print("fixtures written to", d)
