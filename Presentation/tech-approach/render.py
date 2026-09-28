import sys, asyncio
from playwright.async_api import async_playwright
async def main(src, out, w, h, scale):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
        await pg.goto("file://" + src); await pg.wait_for_timeout(400)
        await pg.screenshot(path=out, full_page=False); await b.close()
a = sys.argv; asyncio.run(main(a[1], a[2], int(a[3]), int(a[4]), float(a[5])))
