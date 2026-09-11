# -*- coding: utf-8 -*-
"""Telecharge en local toutes les images utilisees par le site."""
import json, os, re, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'assets', 'img')
os.makedirs(OUT, exist_ok=True)

SITE_ASSETS = [
    "https://417france.com/cdn/shop/files/logo_Fr_noir_petit.png?v=1768847399",
    "https://417france.com/cdn/shop/files/logo_Fr_blanc_petit.png?v=1768310525",
    "https://417france.com/cdn/shop/files/logo_blanc_4e4e692e-d8a0-4022-8a88-7fbf3bb8d3a0.png?v=1768249728",
    "https://417france.com/cdn/shop/files/logo_Fr.jpg?v=1769376658",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/KIK03022_2_ret_2.jpg?v=1768249120",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/KIK03022_2_f_2.jpg?v=1768249162",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/KIK03022_2_ret_f_e.jpg?v=1768765918",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Generated_Image_January_12_2026_-_10_07PM.png?v=1768252083",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Generated_Image_January_12_2026_-_10_32PM.png?v=1768253610",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Generated_Image_January_12_2026_-_10_20PM.png?v=1768253016",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Generated_Image_January_12_2026_-_10_26PM.png?v=1768253277",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Copilot_20260112_214835.png?v=1768250954",
    "https://cdn.shopify.com/s/files/1/0726/1221/7115/files/ecom-no-replace-oeymwW5fH4ic-sh-1.png?v=1753841447",
    "https://cdn.shopify.com/s/files/1/0726/1221/7115/files/ecom-no-replace-L4i0479FGvic-sh-2.png?v=1753841499",
    "https://cdn.shopify.com/s/files/1/0726/1221/7115/files/ecom-no-replace-P6DT5pDvddic-sh-3.png?v=1753841545",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/logo_joe_event_grand.jpg?v=1769124705",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/prescription-lab-new-logo_bb3c33f5-13ac-4c71-bd34-af73937749eb.png?v=1768261252",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/Amazon-Logo-1998-2000.jpg?v=1768260931",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/logo.jpg?v=1768260931",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/nocibe_logo-scaled.jpg?v=1768260930",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/logo-np.jpg?v=1768260931",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/blissim-logo.png?v=1768260930",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/beaute-test-logo.jpg?v=1768260930",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/feelbe-new-logo.webp?v=1768260929",
    "https://cdn.shopify.com/s/files/1/0944/6044/5005/files/online-apotheek-viata.jpg?v=1768260930",
]


def slugify(url):
    base = urllib.parse.urlparse(url).path.split('/')[-1]
    name, ext = os.path.splitext(base)
    name = re.sub(r'[^A-Za-z0-9_-]+', '-', name).strip('-').lower()
    return (name[:80] or 'image') + ext.lower()


def collect():
    urls = list(SITE_ASSETS)
    with open(os.path.join(ROOT, 'data', 'products.json'), encoding='utf-8') as f:
        for p in json.load(f)['products']:
            for img in p.get('images', []):
                urls.append(img['src'])
    seen, out = set(), []
    for u in urls:
        if u.startswith('//'):
            u = 'https:' + u
        key = u.split('?')[0]
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def download(url):
    target = slugify(url)
    path = os.path.join(OUT, target)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return url, target, 'cache'
    req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'width=1400',
                                 headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
        return url, target, 'ok %d ko' % (len(data) // 1024)
    except Exception as exc:                                   # noqa: BLE001
        return url, None, 'ERREUR %s' % exc


def main():
    urls = collect()
    mapping = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for url, target, status in pool.map(download, urls):
            print('%-10s %s' % (status, target or url))
            if target:
                mapping[url.split('?')[0]] = 'assets/img/' + target
    with open(os.path.join(ROOT, 'data', 'image-map.json'), 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print('%d images / %d attendues' % (len(mapping), len(urls)))


if __name__ == '__main__':
    main()
