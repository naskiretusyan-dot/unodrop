import json
import urllib.request
import re
import os

def fetch_json(url):
    print(f"Fetching {url}...")
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read().decode())

def get_image_map():
    urls = [
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/stickers.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/collectibles.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/agents.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/music_kits.json",
        "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/graffiti.json"
    ]
    
    image_map = {}
    rarity_map = {}
    
    for url in urls:
        try:
            items = fetch_json(url)
            for item in items:
                name = item.get('name', '')
                img = item.get('image', '')
                rarity = item.get('rarity', {}).get('name', '')
                if name and img:
                    image_map[name] = img
                    if rarity:
                        rarity_map[name] = rarity
        except Exception as e:
            print(f"Error fetching/parsing {url}: {e}")
            
    return image_map, rarity_map

def main():
    input_file = "skins and prices.txt"
    output_file = "skins_data.js"
    exchange_rate = 1.0 # Keep prices in RUB (no conversion)
    
    if not os.path.exists(input_file):
        print(f"Input file {input_file} not found!")
        return

    img_map, rarity_map = get_image_map()
    
    all_skins = []
    
    # Common wears to strip from names to find the base item for image lookup
    wears = ["(Factory New)", "(Minimal Wear)", "(Field-Tested)", "(Well-Worn)", "(Battle-Scarred)"]
    
    with open(input_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or ': ' not in line:
                continue
                
            # Split from the right to handle ':' in names (rare but possible)
            parts = line.rsplit(': ', 1)
            name = parts[0]
            price_str = parts[1].replace(' RUB', '').replace(',', '.').strip()
            
            try:
                price_rub = float(price_str)
            except ValueError:
                continue
                
            price_usd = round(price_rub * exchange_rate, 2)
            
            # Find image
            img = img_map.get(name)
            rarity = rarity_map.get(name, "Common")
            
            if not img:
                # Try stripping the wear
                base_name = name
                for wear in wears:
                    if wear in name:
                        base_name = name.replace(wear, "").strip()
                        break
                img = img_map.get(base_name)
                # If still not found, check if it's a skin with a ★
                if not img and not base_name.startswith("★ "):
                    img = img_map.get(f"★ {base_name}")
                
                if not img and base_name.startswith("★ "):
                    img = img_map.get(base_name.replace("★ ", ""))
                
                # Copy rarity if found for base
                if not rarity or rarity == "Common":
                    rarity = rarity_map.get(base_name, "Common")

            if img:
                all_skins.append({
                    "name": name.replace("★ ", ""),
                    "fullName": name,
                    "price": price_usd,
                    "img": img,
                    "rarity": rarity
                })

    # Sort by price descending
    all_skins.sort(key=lambda x: x['price'], reverse=True)
    
    print(f"Processed {len(all_skins)} skins.")
    
    # Save as JS file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("window.allSkinsData = ")
        json.dump(all_skins, f, indent=2, ensure_ascii=False)
        f.write(";")

if __name__ == "__main__":
    main()