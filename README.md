# Riftbound-Bot

A Discord bot for marketplace management and TikTok integration, written in TypeScript.


## Features & Detailed Usage

### 1. Marketplace Tools
Το bot προσφέρει ολοκληρωμένο σύστημα marketplace για αγοραπωλησίες καρτών/αντικειμένων μέσω Discord:

- **Δημιουργία αγγελίας (Buy/Sell):**
   - Ο χρήστης εκτελεί `/market post` και επιλέγει τύπο (αγορά/πώληση), ανεβάζει φωτογραφίες και συμπληρώνει τα στοιχεία της αγγελίας μέσω modal.
   - Η αγγελία πηγαίνει για έγκριση σε ειδικό κανάλι (MARKET_LOG_CHANNEL_ID) όπου οι moderators μπορούν να την εγκρίνουν ή να την απορρίψουν με κουμπιά.
   - Μετά την έγκριση, η αγγελία δημοσιεύεται στο κατάλληλο κανάλι (SELL_CHANNEL_ID ή BUY_CHANNEL_ID).
- **Reputation System:**
   - Κάθε ολοκληρωμένη συναλλαγή ενημερώνει το reputation του χρήστη (ως αγοραστής ή πωλητής).
   - Τα δεδομένα αποθηκεύονται στο `data/reputation.json`.
- **Mod Actions:**
   - Οι moderators μπορούν να διαχειριστούν αγγελίες, να επικοινωνήσουν με χρήστες, να κλείσουν threads και να επιλύσουν διαφορές μέσω ειδικών κουμπιών και modals.

**Παράδειγμα ροής:**
1. Ο χρήστης γράφει `/market post` → συμπληρώνει τα στοιχεία.
2. Η αγγελία εμφανίζεται για έγκριση στους mods.
3. Mod πατάει "Approve" → η αγγελία δημοσιεύεται.
4. Μετά τη συναλλαγή, ενημερώνεται το reputation.

### 2. TikTok Integration
Το bot παρακολουθεί νέο περιεχόμενο TikTok και το δημοσιεύει αυτόματα στο Discord:

- **Αυτόματη ανάρτηση νέων TikTok videos:**
   - Το bot διαβάζει το αρχείο `tiktok_debug_item_list_webfull_json.txt` (ή άλλο integration) για νέα videos.
   - Αν βρεθεί νέο video, το δημοσιεύει στο κανάλι `TIKTOK_CHANNEL_ID` με ping (αν έχει οριστεί).

# Riftbound-Bot

A Discord bot for marketplace management and TikTok integration, written in TypeScript.

## Features & Detailed Usage

### 1. Marketplace Tools
The bot provides a complete marketplace system for buying/selling cards or items via Discord:

- **Create Listing (Buy/Sell):**
   - The user runs `/market post`, selects type (buy/sell), uploads photos, and fills in listing details via a modal.
   - The listing is sent for approval to a special channel (`MARKET_LOG_CHANNEL_ID`) where moderators can approve or reject it via buttons.
   - After approval, the listing is published in the appropriate channel (`SELL_CHANNEL_ID` or `BUY_CHANNEL_ID`).
- **Reputation System:**
   - Each completed transaction updates the user's reputation (as buyer or seller).
   - Data is stored in `data/reputation.json`.
- **Mod Actions:**
   - Moderators can manage listings, contact users, close threads, and resolve disputes via special buttons and modals.

**Example flow:**
1. User runs `/market post` → fills in details.
2. Listing appears for approval to mods.
3. Mod clicks "Approve" → listing is published.
4. After the transaction, reputation is updated.

### 2. TikTok Integration
The bot monitors new TikTok content and automatically posts it to Discord:

- **Automatic posting of new TikTok videos:**
   - The bot reads the file `tiktok_debug_item_list_webfull_json.txt` (or other integration) for new videos.
   - If a new video is found, it posts it to the `TIKTOK_CHANNEL_ID` channel with a ping (if set).
- **Slash Commands:**
   - `/tiktok status`: Shows the last TikTok that was posted.
   - `/tiktok check`: Checks if there is a new video and posts it if needed.
   - `/tiktok post [id]`: Posts a specific video id or the latest from the debug file.
   - `/tiktok show`: Shows info about the latest video in the debug file.

**Example flow:**
1. New video appears in the debug file.
2. The bot detects it and posts it automatically to Discord.
3. Users can check/force post via slash commands.

### 3. Environments (Production & Development)
- Multiple environments are supported via `.env.prod` and `.env.dev`.
- You can run two bots simultaneously (production & development) with different tokens and settings.
- All configuration is done via .env files.

### 4. Modular Command Structure
- All commands and interactions are modular (marketplace, tiktok, ping, etc).
- Easily extendable with new commands or integrations.

---

## Folder Structure
```
riftbound-bot/
├── data/                  # JSON data files (posts, deals, reputation, tiktok state)
├── dist/                  # Compiled output (ignored)
├── node_modules/          # Dependencies (ignored)
├── scripts/               # Utility scripts (if any)
├── src/
│   ├── commands/          # (Placeholder for custom commands)
│   ├── lib/               # Helpers and JSON store utilities
│   ├── marketplace/       # Marketplace logic and commands
│   ├── socials/           # TikTok integration
│   ├── types/             # Type definitions and config
│   └── index.ts           # Main entry point
├── .env.example           # Example environment variables
├── .env.prod              # Production environment variables (not committed)
├── .env.dev               # Development environment variables (not committed)
├── package.json           # Project metadata and scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

## Setup
1. **Install dependencies:**
    ```sh
    npm install
    ```
2. **Configure environment:**
    - Copy `.env.example` to `.env.prod` and `.env.dev`.
    - Fill in the required tokens, IDs, and credentials for each environment.
3. **Run the bot:**
    - For production:
       ```sh
       npm run dev:prod
       ```
    - For development:
       ```sh
       npm run dev:dev
       ```

## Environment Variables
- `TOKEN` - Discord bot token
- `CLIENT_ID` - Discord application client ID
- `GUILD_ID` - (Optional) For guild-only command registration
- `SELL_CHANNEL_ID`, `BUY_CHANNEL_ID`, `MOD_CHANNEL_ID`, `MARKET_LOG_CHANNEL_ID`, `MOD_ROLE_ID` - Marketplace channel/role IDs
- `TIKTOK_USERNAME`, `TIKTOK_CHANNEL_ID`, `TIKTOK_PING_EVERYONE`, `TIKTOK_COOKIE` - TikTok integration

See `.env.example` for all variables.

## Development Flow
- Use separate branches for development and production.
- Work on the `dev` branch with `.env.dev` and test bot credentials.
- Merge to `main` for production deployment.
- Both bots can run simultaneously on different terminals.

## Useful Scripts
- `npm run dev:prod` - Run production bot with `.env.prod`
- `npm run dev:dev` - Run development bot with `.env.dev`
- `npm run build` - Compile TypeScript
- `npm start` - Run compiled bot from `dist/`

## Notes
- Do **not** commit `.env.prod` or `.env.dev` (keep secrets private).
- Data files in `data/` are used for runtime storage (posts, deals, etc).
- For new Discord servers, update the relevant IDs in your `.env` files.

---

For questions or contributions, contact the project maintainer.
3. **Run the bot:**
   - For production:
     ```sh
     npm run dev:prod
     ```
   - For development:
     ```sh
     npm run dev:dev
     ```

## Environment Variables
- `TOKEN` - Discord bot token
- `CLIENT_ID` - Discord application client ID
- `GUILD_ID` - (Optional) For guild-only command registration
- `SELL_CHANNEL_ID`, `BUY_CHANNEL_ID`, `MOD_CHANNEL_ID`, `MARKET_LOG_CHANNEL_ID`, `MOD_ROLE_ID` - Marketplace channel/role IDs
- `TIKTOK_USERNAME`, `TIKTOK_CHANNEL_ID`, `TIKTOK_PING_EVERYONE`, `TIKTOK_COOKIE` - TikTok integration

See `.env.example` for all variables.

## Development Flow
- Use separate branches for development and production.
- Work on the `dev` branch with `.env.dev` and test bot credentials.
- Merge to `main` for production deployment.
- Both bots can run simultaneously on different terminals.

## Useful Scripts
- `npm run dev:prod` - Run production bot with `.env.prod`
- `npm run dev:dev` - Run development bot with `.env.dev`
- `npm run build` - Compile TypeScript
- `npm start` - Run compiled bot from `dist/`

## Notes
- Do **not** commit `.env.prod` or `.env.dev` (keep secrets private).
- Data files in `data/` are used for runtime storage (posts, deals, etc).
- For new Discord servers, update the relevant IDs in your `.env` files.

---

Για απορίες ή συνεισφορά, επικοινώνησε με τον δημιουργό του project.
