require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const cors = require("cors");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

const {
  FREE_INVITE_CODE,
  PAID_INVITE_CODE,
  FREE_ROLE_ID,
  FREE_VERIFIED_ROLE_ID,
  PAID_ROLE_ID,
  STUDENT_CHANNEL_CATEGORY_ID,
  STAFF_ROLE_ID,
  LEAD_WEBHOOK_API_KEY,
  GUILD_ID,
} = process.env;

const INVITE_ROLE_MAP = {
  [FREE_INVITE_CODE]: FREE_ROLE_ID,
  [PAID_INVITE_CODE]: PAID_ROLE_ID,
};

// ── invite use-count cache ──────────────────────────────
const inviteCache = new Map(); // guildId -> Map(code -> uses)

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach((inv) => map.set(inv.code, inv.uses));
    inviteCache.set(guild.id, map);
  } catch (err) {
    console.error(`could not cache invites for ${guild.id}:`, err.message);
  }
}

client.once("ready", async () => {
  console.log(`✅ community bot ready: ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
});

client.on("inviteCreate", (invite) => cacheGuildInvites(invite.guild));
client.on("inviteDelete", (invite) => cacheGuildInvites(invite.guild));

// ── create the 1:1 channel for a new paid student ───────
async function createStudentChannel(member) {
  if (!STUDENT_CHANNEL_CATEGORY_ID) return;
  const guild = member.guild;
  const name = `student-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const overwrites = [
    { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
    { id: member.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
  ];
  if (STAFF_ROLE_ID) {
    overwrites.push({ id: STAFF_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] });
  }

  await guild.channels.create({
    name,
    parent: STUDENT_CHANNEL_CATEGORY_ID,
    permissionOverwrites: overwrites,
  });
}

// ── on join: diff invite usage, assign role, create channel if paid ─
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;
  const before = inviteCache.get(guild.id) || new Map();
  await cacheGuildInvites(guild);
  const after = inviteCache.get(guild.id) || new Map();

  let usedCode = null;
  for (const [code, uses] of after.entries()) {
    if ((before.get(code) || 0) < uses) {
      usedCode = code;
      break;
    }
  }

  if (!usedCode) {
    console.log(`could not determine invite used by ${member.user.tag}`);
    return;
  }

  const roleId = INVITE_ROLE_MAP[usedCode];
  if (!roleId) return;

  try {
    await member.roles.add(roleId);
    console.log(`assigned role ${roleId} to ${member.user.tag} via invite ${usedCode}`);
  } catch (err) {
    console.error(`failed to assign role to ${member.user.tag}:`, err.message);
  }

  if (roleId === PAID_ROLE_ID) {
    await createStudentChannel(member);
  }
});

// ── express: lead form webhook ──────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => res.send("dialled community bot running"));
app.get("/health", (_, res) => res.json({ status: "ok" }));

// ── application button + modal ──────────────────────────
const {
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require("discord.js");

const APPLY_WEBHOOK_URL = process.env.APPLY_WEBHOOK_URL || null; // optional, e.g. zapier catch hook
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID || null; // optional fallback record

// register the /post-apply-button command on startup (guild-scoped, instant)
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("post-apply-button")
      .setDescription("post the job board access button in this channel (staff only)"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
  console.log("✅ slash command registered");
}

client.once("ready", async () => {
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  // staff posts the button
  if (interaction.isChatInputCommand() && interaction.commandName === "post-apply-button") {
    if (STAFF_ROLE_ID && !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
      return interaction.reply({ content: "staff only.", ephemeral: true });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_apply_modal")
        .setLabel("get job board access")
        .setStyle(ButtonStyle.Success)
    );
    const applyEmbed = new EmbedBuilder()
      .setTitle("Get access to the Dialled Job Board")
      .setDescription(
        "We regularly add new closing and setting opportunities for you to apply to.\n\n" +
        "Tap the button below, fill in your details, and you'll get access. Takes about 30 seconds."
      )
      .setColor(0x57f287)
      .setFooter({ text: "Posted via Dialled Portal" });

    await interaction.channel.send({
      embeds: [applyEmbed],
      components: [row],
    });
    await interaction.reply({ content: "posted.", ephemeral: true });
    return;
  }

  // click opens the modal
  if (interaction.isButton() && interaction.customId === "open_apply_modal") {
    const modal = new ModalBuilder()
      .setCustomId("apply_modal")
      .setTitle("job board access");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("name").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("email").setLabel("email").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("phone").setLabel("phone number").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("instagram").setLabel("instagram handle").setStyle(TextInputStyle.Short).setRequired(true)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // modal submit: grant role, forward the data, log it
  if (interaction.isModalSubmit() && interaction.customId === "apply_modal") {
    await interaction.deferReply({ ephemeral: true });

    const answers = {
      discord_id: interaction.user.id,
      discord_username: interaction.user.username,
      name: interaction.fields.getTextInputValue("name"),
      email: interaction.fields.getTextInputValue("email"),
      phone: interaction.fields.getTextInputValue("phone"),
      instagram: interaction.fields.getTextInputValue("instagram"),
    };

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(FREE_VERIFIED_ROLE_ID);
    } catch (err) {
      console.error("role grant failed:", err.message);
      await interaction.editReply("something went wrong granting access, message ryan directly.");
      return;
    }

    if (APPLY_WEBHOOK_URL) {
      fetch(APPLY_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      }).catch((err) => console.error("webhook forward failed:", err.message));
    }

    if (STAFF_LOG_CHANNEL_ID) {
      try {
        const logChannel = await client.channels.fetch(STAFF_LOG_CHANNEL_ID);
        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("new job board application")
              .addFields(
                { name: "name", value: answers.name, inline: true },
                { name: "email", value: answers.email, inline: true },
                { name: "phone", value: answers.phone, inline: true },
                { name: "instagram", value: answers.instagram, inline: true },
                { name: "discord", value: `<@${answers.discord_id}>`, inline: true },
              )
              .setColor(0x57f287)
              .setTimestamp(),
          ],
        });
      } catch (err) {
        console.error("staff log post failed:", err.message);
      }
    }

    console.log(`new applicant: ${answers.name} (${answers.email}) discord_id=${answers.discord_id}`);
    await interaction.editReply("you're in, job board access unlocked.");
    return;
  }
});

// manual fallback, kept in case the button flow ever fails for someone
app.post("/api/verify-lead", async (req, res) => {
  if (LEAD_WEBHOOK_API_KEY && req.headers["x-api-key"] !== LEAD_WEBHOOK_API_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }
  const { discord_id } = req.body;
  if (!discord_id) return res.status(400).json({ error: "discord_id required" });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);
    await member.roles.add(FREE_VERIFIED_ROLE_ID);
    res.json({ success: true });
  } catch (err) {
    console.error("verify-lead error:", err.message);
    res.status(500).json({ error: "could not assign role, check discord_id is correct" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ webhook listening on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
