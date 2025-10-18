// src/marketplace/marketPanel.ts
import {
  Client,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  PermissionFlagsBits,
} from "discord.js";

export const marketPanelCommand = new SlashCommandBuilder()
  .setName("market-panel")
  .setDescription("Στέλνει το μονίμως posted panel του marketplace (μόνο για mods)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export function getMarketPanelCommand() {
  return [marketPanelCommand];
}

// ---------- Helper: δημιουργεί dropdown με dynamic customId ----------
function createMarketDropdown() {
  const customId = `market-kind-select-${Date.now()}`;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("➡️ Επίλεξε τύπο αγγελίας")
    .addOptions(
      { label: "Sell", value: "sell", emoji: "💰", description: "Πώληση κάρτας/προϊόντος" },
      { label: "Buy", value: "buy", emoji: "🛒", description: "Αγορά κάρτας/προϊόντος" },
      { label: "Trade", value: "trade", emoji: "🔁", description: "Ανταλλαγή κάρτας/προϊόντος" }
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  return { row, customId };
}

export function registerMarketPanelInteractions(client: Client) {
  client.on("interactionCreate", async (interaction) => {
    // ----- /market-panel command for mods -----
    if (interaction.isChatInputCommand() && interaction.commandName === "market-panel") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({ content: "❌ Μόνο mods μπορούν να το κάνουν αυτό.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle("📦 Marketplace • Δημιούργησε Αγγελία")
        .setDescription(
          "Καλώς ήρθες στο Riftbound Marketplace!\n\n" +
          "Επίλεξε τον τύπο της αγγελίας σου από το dropdown menu παρακάτω:\n" +
          "💰 **Sell** — Πώληση κάρτας/προϊόντος\n" +
          "🛒 **Buy** — Αγορά κάρτας/προϊόντος\n" +
          "🔁 **Trade** — Ανταλλαγή κάρτας/προϊόντος"
        )
        .setFooter({ text: "Riftbound Marketplace • Ακολούθησε τις οδηγίες για να ολοκληρώσεις την αγγελία σου" })
        .setThumbnail(interaction.guild?.iconURL() || null);

      const { row } = createMarketDropdown();
      
      await interaction.reply({ 
        embeds: [embed], 
        components: [row],
        fetchReply: true 
      });
      return;
    }

    // ----- Dropdown interaction -----
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("market-kind-select-")) return;

      const kind = interaction.values[0];

      // Modal με kind μέσα στο customId
      const modal = new ModalBuilder()
        .setCustomId(`marketPost-${kind}`) // π.χ. marketPost-sell
        .setTitle(`Νέα αγγελία • ${kind.toUpperCase()}`);

      if (kind === "trade") {
        const offerTitle = new TextInputBuilder()
          .setCustomId("offerTitle")
          .setLabel("Τι προσφέρεις")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. Jinx Foil Edition")
          .setRequired(true);
        
        const offerQty = new TextInputBuilder()
          .setCustomId("offerQty")
          .setLabel("Ποσότητα (προσφορά)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. 1")
          .setRequired(true);
        
        const wantTitle = new TextInputBuilder()
          .setCustomId("wantTitle")
          .setLabel("Τι ζητάς")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. Vi Rare")
          .setRequired(true);
        
        const wantQty = new TextInputBuilder()
          .setCustomId("wantQty")
          .setLabel("Ποσότητα (ζητούμενο)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. 1")
          .setRequired(true);
        
        const cashDelta = new TextInputBuilder()
          .setCustomId("cashDelta")
          .setLabel("Διαφορά σε € (+ζητάς, -δίνεις)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. +5 ή -10 ή 0")
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(offerTitle),
          new ActionRowBuilder<TextInputBuilder>().addComponents(offerQty),
          new ActionRowBuilder<TextInputBuilder>().addComponents(wantTitle),
          new ActionRowBuilder<TextInputBuilder>().addComponents(wantQty),
          new ActionRowBuilder<TextInputBuilder>().addComponents(cashDelta)
        );
      } else {
        const card = new TextInputBuilder()
          .setCustomId("cardName")
          .setLabel("Όνομα Κάρτας/Προϊόντος")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. Jinx Foil Edition")
          .setRequired(true);
        
        const location = new TextInputBuilder()
          .setCustomId("location")
          .setLabel("Περιοχή")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. Αθήνα, Θεσσαλονίκη")
          .setRequired(false);
        
        const quantity = new TextInputBuilder()
          .setCustomId("quantity")
          .setLabel("Ποσότητα")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. 1")
          .setRequired(true);
        
        const price = new TextInputBuilder()
          .setCustomId("price")
          .setLabel(kind === "buy" ? "Budget (€)" : "Τιμή (€)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("π.χ. 15.00")
          .setRequired(true);
        
        const extra = new TextInputBuilder()
          .setCustomId("extra")
          .setLabel("Extra πληροφορίες")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("π.χ. Τρόπος παράδοσης, κατάσταση κάρτας, κλπ")
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(card),
          new ActionRowBuilder<TextInputBuilder>().addComponents(location),
          new ActionRowBuilder<TextInputBuilder>().addComponents(quantity),
          new ActionRowBuilder<TextInputBuilder>().addComponents(price),
          new ActionRowBuilder<TextInputBuilder>().addComponents(extra)
        );
      }

      // 🔹 Ανοίγει modal
      await interaction.showModal(modal);

      // 🔹 Κάνει reset dropdown αμέσως μετά
      try {
        const message = await interaction.message.fetch();
        const { row: newRow } = createMarketDropdown();
        await message.edit({ components: [newRow] });
      } catch (err) {
        console.error("[marketPanel] Failed to reset dropdown:", err);
      }
    }
  });
}