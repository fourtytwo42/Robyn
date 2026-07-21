from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = ROOT / "research" / "screenshots" / "launchpad-subpages"

GROUPS = [
    (
        "contact-sheet-creation.png",
        [
            ("Pump.fun - Create", "pump-create.png"),
            ("Bags - Launch", "bags-launch.png"),
            ("Four.meme - Create", "four-create.png"),
            ("Clanker - Deploy", "clanker-deploy.png"),
            ("hood.fun - Create", "hood-create.png"),
            ("pons - Create", "pons-create.png"),
            ("Virtuals - Launch Token", "virtuals-launch-token.png"),
            ("Virtuals - Create Agent", "virtuals-create-agent.png"),
        ],
    ),
    (
        "contact-sheet-token-pages.png",
        [
            ("Pump.fun - Token", "pump-token-detail.png"),
            ("Bags - Token", "bags-token-detail.png"),
            ("Four.meme - Token", "four-token-detail.png"),
            ("Clanker - Token", "clanker-token-detail.png"),
            ("hood.fun - Community Token", "hood-community-token.png"),
            ("pons - Token Attempt", "pons-token-detail.png"),
            ("Virtuals - Agent Token", "virtuals-agent-detail.png"),
        ],
    ),
    (
        "contact-sheet-discovery-rewards.png",
        [
            ("Bags - Trade", "bags-trade.png"),
            ("Clanker - Explore", "clanker-explore.png"),
            ("BONKfun - Bond Rewards", "bonk-rewards.png"),
        ],
    ),
    (
        "contact-sheet-profiles.png",
        [
            ("Pump.fun - Profile", "pump-profile.png"),
            ("Clanker - Profile", "clanker-profile.png"),
            ("hood.fun - Portfolio", "hood-portfolio.png"),
            ("pons - Profile", "pons-profile.png"),
        ],
    ),
]

TILE_WIDTH = 700
TILE_HEIGHT = 438
LABEL_HEIGHT = 42
GAP = 20
BACKGROUND = "#111418"
LABEL_COLOR = "#f2f4f7"
BORDER_COLOR = "#39414a"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def build_sheet(filename: str, items: list[tuple[str, str]]) -> None:
    rows = (len(items) + 1) // 2
    width = TILE_WIDTH * 2 + GAP * 3
    height = rows * (TILE_HEIGHT + LABEL_HEIGHT) + GAP * (rows + 1)
    sheet = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    label_font = font(22)

    for index, (label, image_name) in enumerate(items):
        row, column = divmod(index, 2)
        x = GAP + column * (TILE_WIDTH + GAP)
        y = GAP + row * (TILE_HEIGHT + LABEL_HEIGHT + GAP)
        source = Image.open(SHOT_DIR / image_name).convert("RGB")
        tile = ImageOps.fit(source, (TILE_WIDTH, TILE_HEIGHT), method=Image.Resampling.LANCZOS)
        sheet.paste(tile, (x, y + LABEL_HEIGHT))
        draw.rectangle(
            (x, y + LABEL_HEIGHT, x + TILE_WIDTH - 1, y + LABEL_HEIGHT + TILE_HEIGHT - 1),
            outline=BORDER_COLOR,
            width=2,
        )
        draw.text((x, y + 7), label, fill=LABEL_COLOR, font=label_font)

    sheet.save(SHOT_DIR / filename, optimize=True)


for output_name, group in GROUPS:
    build_sheet(output_name, group)
    print(SHOT_DIR / output_name)
