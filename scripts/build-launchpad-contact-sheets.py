from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = ROOT / "research" / "screenshots" / "launchpads"

GROUPS = [
    (
        "contact-sheet-solana-evm.png",
        [
            ("Pump.fun - Solana", "pump-fun.png"),
            ("Bags - Solana / Robinhood", "bags.png"),
            ("Believe - Solana", "believe.png"),
            ("BONKfun - Solana", "letsbonk.png"),
            ("DAOS.FUN - Solana", "daos-fun.png"),
            ("Clanker - Base / EVM", "clanker.png"),
            ("Zora - Base", "zora.png"),
        ],
    ),
    (
        "contact-sheet-other-robinhood.png",
        [
            ("Four.meme - BNB Chain", "four-meme.png"),
            ("PinkSale - Multichain", "pinksale.png"),
            ("SunPump - TRON", "sunpump.png"),
            ("Virtuals - Base / Solana", "virtuals.png"),
            ("pons - Robinhood Chain", "pons.png"),
            ("hood.fun - Robinhood Chain", "hood-fun.png"),
        ],
    ),
]

TILE_WIDTH = 700
IMAGE_HEIGHT = 438
LABEL_HEIGHT = 52
GAP = 20
MARGIN = 20
BACKGROUND = "#111318"
LABEL_BACKGROUND = "#1c2028"
TEXT = "#f5f7fa"
FONT = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 24)


for output_name, entries in GROUPS:
    rows = (len(entries) + 1) // 2
    sheet_width = MARGIN * 2 + TILE_WIDTH * 2 + GAP
    sheet_height = MARGIN * 2 + rows * (IMAGE_HEIGHT + LABEL_HEIGHT) + (rows - 1) * GAP
    sheet = Image.new("RGB", (sheet_width, sheet_height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)

    for index, (label, filename) in enumerate(entries):
        row, column = divmod(index, 2)
        x = MARGIN + column * (TILE_WIDTH + GAP)
        y = MARGIN + row * (IMAGE_HEIGHT + LABEL_HEIGHT + GAP)

        source = Image.open(SHOT_DIR / filename).convert("RGB")
        fitted = ImageOps.fit(source, (TILE_WIDTH, IMAGE_HEIGHT), method=Image.Resampling.LANCZOS)
        sheet.paste(fitted, (x, y))
        draw.rectangle(
            (x, y + IMAGE_HEIGHT, x + TILE_WIDTH, y + IMAGE_HEIGHT + LABEL_HEIGHT),
            fill=LABEL_BACKGROUND,
        )
        draw.text((x + 16, y + IMAGE_HEIGHT + 12), label, font=FONT, fill=TEXT)

    sheet.save(SHOT_DIR / output_name, "PNG", optimize=True)
    print(SHOT_DIR / output_name)
