require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
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

const APPLY_WEBHOOK_URL = process.env.APPLY_WEBHOOK_URL || null; // optional, e.g. zapier catch hook
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID || null; // optional fallback record
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID || "1541814286194581685"; // "learn about HTS" channel
const WINS_CHANNEL_ID = process.env.WINS_CHANNEL_ID || "1470437209248104482"; // wins channel
const ONBOARDING_LOG_CHANNEL_ID =
  process.env.ONBOARDING_LOG_CHANNEL_ID || "1470437209437110455"; // 📃┃onboarding-logs

// student channel naming: 🤵🏻┃their-discord-name
const STUDENT_CHANNEL_PREFIX = "🤵🏻┃";

// ── invite source config ────────────────────────────────
// each invite code maps to a source, so joins can be attributed to the place
// the link was posted. to add a source: create the invite in discord, put the
// code in an env var, add one registerInviteSource() line below.
const INVITE_SOURCES = {}; // code -> { label, emoji, roleId, color, paid }

function registerInviteSource(code, config) {
  if (!code) return;
  if (INVITE_SOURCES[code]) {
    console.warn(
      `invite code ${code} is configured for both "${INVITE_SOURCES[code].label}" and "${config.label}", keeping the first`
    );
    return;
  }
  INVITE_SOURCES[code] = config;
}

// paid
registerInviteSource(PAID_INVITE_CODE, {
  label: "Paid Program",
  emoji: "💰",
  roleId: PAID_ROLE_ID,
  color: 0xf1c40f,
  paid: true,
});

// free, split by where the link lives
registerInviteSource(process.env.FREE_INVITE_CODE_YOUTUBE, {
  label: "YouTube",
  emoji: "▶️",
  roleId: FREE_ROLE_ID,
  color: 0xff0000,
});
registerInviteSource(process.env.FREE_INVITE_CODE_BOOKING, {
  label: "Post-Call Booking Page",
  emoji: "📅",
  roleId: FREE_ROLE_ID,
  color: 0x57f287,
});
registerInviteSource(process.env.FREE_INVITE_CODE_INSTAGRAM, {
  label: "Instagram Bio / DMs",
  emoji: "📸",
  roleId: FREE_ROLE_ID,
  color: 0xe1306c,
});
registerInviteSource(process.env.FREE_INVITE_CODE_TIKTOK, {
  label: "TikTok",
  emoji: "🎵",
  roleId: FREE_ROLE_ID,
  color: 0x2c2f33,
});
registerInviteSource(process.env.FREE_INVITE_CODE_EMAIL, {
  label: "Email / Nurture Sequence",
  emoji: "✉️",
  roleId: FREE_ROLE_ID,
  color: 0x3498db,
});
registerInviteSource(process.env.FREE_INVITE_CODE_REFERRAL, {
  label: "Student Referral",
  emoji: "🤝",
  roleId: FREE_ROLE_ID,
  color: 0x9b59b6,
});
registerInviteSource(process.env.FREE_INVITE_CODE_ADS, {
  label: "Paid Ads",
  emoji: "🎯",
  roleId: FREE_ROLE_ID,
  color: 0xe67e22,
});
registerInviteSource(process.env.FREE_INVITE_CODE_OUTREACH, {
  label: "Cold Outreach / DMs",
  emoji: "📤",
  roleId: FREE_ROLE_ID,
  color: 0x1abc9c,
});

// generic free link, registered last so a more specific source wins if the
// same code ends up in two env vars by mistake
registerInviteSource(FREE_INVITE_CODE, {
  label: "Free (general link)",
  emoji: "🔗",
  roleId: FREE_ROLE_ID,
  color: 0x5865f2,
});

const UNKNOWN_SOURCE = {
  label: "Unknown / untracked invite",
  emoji: "❓",
  roleId: null,
  color: 0x95a5a6,
};

// ── invite use-count cache ──────────────────────────────
const inviteCache = new Map(); // guildId -> Map(code -> uses)

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach((inv) => map.set(inv.code, inv.uses));
    inviteCache.set(guild.id, map);
    return map;
  } catch (err) {
    console.error(`could not cache invites for ${guild.id}:`, err.message);
    return null;
  }
}

// ── slash command registration ──────────────────────────
async function registerCommands() {
  if (!GUILD_ID) {
    console.error("GUILD_ID not set, skipping slash command registration");
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("post-apply-button")
      .setDescription("post the job board access button in this channel (staff only)"),
    new SlashCommandBuilder()
      .setName("invite-stats")
      .setDescription("show total joins per tracked invite link (staff only)"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: commands,
  });
  console.log("✅ slash commands registered");
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ community bot ready: ${client.user.tag}`);

  const tracked = Object.entries(INVITE_SOURCES);
  console.log(`tracking ${tracked.length} invite source(s):`);
  tracked.forEach(([code, s]) => console.log(`  ${code} -> ${s.label}`));

  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }

  try {
    await registerCommands();
  } catch (err) {
    console.error("slash command registration failed:", err.message);
  }
});

client.on(Events.InviteCreate, (invite) => cacheGuildInvites(invite.guild));
client.on(Events.InviteDelete, (invite) => cacheGuildInvites(invite.guild));

// ── student channel naming + creation ───────────────────
function buildStudentChannelName(member) {
  const raw = member.displayName || member.user.globalName || member.user.username;

  const slug = raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  const safe =
    slug || member.user.username.replace(/[^a-z0-9\-_]/gi, "").toLowerCase() || member.user.id;

  return `${STUDENT_CHANNEL_PREFIX}${safe}`.slice(0, 100);
}

async function createStudentChannel(member) {
  if (!STUDENT_CHANNEL_CATEGORY_ID) return null;

  const guild = member.guild;
  const name = buildStudentChannelName(member);

  await guild.channels.fetch();

  const existing = guild.channels.cache.find(
    (ch) =>
      ch &&
      ch.parentId === STUDENT_CHANNEL_CATEGORY_ID &&
      (ch.name === name || ch.permissionOverwrites?.cache?.has(member.id))
  );

  if (existing) {
    console.log(`student channel already exists for ${member.user.username}: #${existing.name}`);
    return existing;
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (STAFF_ROLE_ID) {
    overwrites.push({
      id: STAFF_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: STUDENT_CHANNEL_CATEGORY_ID,
    permissionOverwrites: overwrites,
  });

  console.log(`created student channel #${channel.name} for ${member.user.username}`);
  return channel;
}

// ── onboarding log ──────────────────────────────────────
function buildJoinLogEmbed({ member, source, code, uses, studentChannel, roleAssigned }) {
  const createdAt = Math.floor(member.user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`${source.emoji} ${source.paid ? "New paid student" : "New member"} joined`)
    .setColor(source.color)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "Member", value: `<@${member.id}>\n\`${member.user.username}\``, inline: true },
      { name: "Came from", value: source.label, inline: true },
      {
        name: "Total from this link",
        value: uses === null || uses === undefined ? "unknown" : `${uses}`,
        inline: true,
      },
      { name: "Invite code", value: code ? `\`${code}\`` : "unknown", inline: true },
      { name: "Account age", value: `<t:${createdAt}:R>`, inline: true },
      { name: "Server member #", value: `${member.guild.memberCount}`, inline: true }
    )
    .setFooter({ text: `user id: ${member.id}` })
    .setTimestamp();

  if (roleAssigned === false) {
    embed.addFields({
      name: "⚠️ Role",
      value: "role assignment failed, check the bot's role position",
      inline: false,
    });
  }

  if (studentChannel) {
    embed.addFields({ name: "Student channel", value: `<#${studentChannel.id}>`, inline: false });
  }

  return embed;
}

async function postOnboardingLog(embed) {
  if (!ONBOARDING_LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(ONBOARDING_LOG_CHANNEL_ID);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("onboarding log post failed:", err.message);
  }
}

// ── on join: attribute the invite, assign role, log it ──
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;
    const before = inviteCache.get(guild.id) || new Map();
    const after = (await cacheGuildInvites(guild)) || new Map();

    let usedCode = null;
    for (const [code, uses] of after.entries()) {
      if ((before.get(code) || 0) < uses) {
        usedCode = code;
        break;
      }
    }

    const source = (usedCode && INVITE_SOURCES[usedCode]) || UNKNOWN_SOURCE;
    const uses = usedCode ? after.get(usedCode) : null;

    let roleAssigned = null;
    let studentChannel = null;

    if (source.roleId) {
      try {
        await member.roles.add(source.roleId);
        roleAssigned = true;
        console.log(
          `${member.user.username} joined via ${source.label} (${usedCode}), role ${source.roleId} assigned`
        );
      } catch (err) {
        roleAssigned = false;
        console.error(`failed to assign role to ${member.user.username}:`, err.message);
      }
    } else {
      console.log(
        `${member.user.username} joined via ${usedCode || "an undetermined invite"}, no role configured`
      );
    }

    if (source.paid && roleAssigned) {
      try {
        studentChannel = await createStudentChannel(member);
      } catch (err) {
        console.error(`failed to create student channel for ${member.user.username}:`, err.message);
      }
    }

    await postOnboardingLog(
      buildJoinLogEmbed({ member, source, code: usedCode, uses, studentChannel, roleAssigned })
    );
  } catch (err) {
    console.error("guildMemberAdd handler error:", err);
  }
});

// ── application button + modal ──────────────────────────
function buildApplyEmbed() {
  return new EmbedBuilder()
    .setTitle("👋 Welcome to Dialled")
    .setDescription(
      "Glad you're here.\n\n" +
        "Dialled helps complete beginners land their first role in high ticket sales, " +
        "as a setter or a closer, and get to their first $10k month.\n\n" +
        `New to all this? Head over to ${SOURCE_CHANNEL_ID ? `<#${SOURCE_CHANNEL_ID}>` : "#free-source"} ` +
        "to learn what high ticket sales actually is and how the whole thing works.\n\n" +
        `You've also got access to ${WINS_CHANNEL_ID ? `<#${WINS_CHANNEL_ID}>` : "#wins"}, ` +
        "where our students post their results as they hit them. Real people, real numbers.\n\n" +
        "**🎯 And when you're ready:** tap below to unlock the Dialled Job Board. " +
        "We regularly add new closing and setting opportunities you can apply to directly, takes about 30 seconds to get in."
    )
    .setColor(0x57f287)
    .setImage("https://i.imgur.com/D4QrYdc.png")
    .setFooter({ text: "Posted via Dialled Portal" });
}

function buildApplyModal() {
  const modal = new ModalBuilder().setCustomId("apply_modal").setTitle("Job Board Access");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("email")
        .setLabel("Email")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("phone")
        .setLabel("Phone Number")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("instagram")
        .setLabel("Instagram Handle")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("goal")
        .setLabel("What's Your Goal With High Ticket Sales?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    )
  );

  return modal;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ── staff posts the button ──
    if (interaction.isChatInputCommand() && interaction.commandName === "post-apply-button") {
      if (STAFF_ROLE_ID && !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: "staff only.", flags: MessageFlags.Ephemeral });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_apply_modal")
          .setLabel("Get Job Board Access")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [buildApplyEmbed()], components: [row] });
      await interaction.reply({ content: "posted.", flags: MessageFlags.Ephemeral });
      return;
    }

    // ── staff checks where people are coming from ──
    if (interaction.isChatInputCommand() && interaction.commandName === "invite-stats") {
      if (STAFF_ROLE_ID && !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: "staff only.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const uses = await cacheGuildInvites(interaction.guild);
      if (!uses) {
        await interaction.editReply("couldn't fetch invites, the bot needs Manage Server.");
        return;
      }

      const rows = Object.entries(INVITE_SOURCES).map(([code, s]) => ({
        label: `${s.emoji} ${s.label}`,
        code,
        uses: uses.get(code),
      }));

      if (!rows.length) {
        await interaction.editReply("no invite sources configured yet.");
        return;
      }

      rows.sort((a, b) => (b.uses ?? -1) - (a.uses ?? -1));
      const total = rows.reduce((sum, r) => sum + (r.uses || 0), 0);

      const embed = new EmbedBuilder()
        .setTitle("📊 Invite source breakdown")
        .setColor(0x5865f2)
        .setDescription(
          rows
            .map((r) =>
              r.uses === undefined
                ? `${r.label} — \`${r.code}\` · **invite not found in this server**`
                : `${r.label} — \`${r.code}\` · **${r.uses}** join${r.uses === 1 ? "" : "s"}`
            )
            .join("\n")
        )
        .setFooter({ text: `${total} total joins across tracked links` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── click opens the modal (blocked if they already have access) ──
    if (interaction.isButton() && interaction.customId === "open_apply_modal") {
      const member =
        interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id));

      if (FREE_VERIFIED_ROLE_ID && member.roles.cache.has(FREE_VERIFIED_ROLE_ID)) {
        await interaction.reply({
          content: "you've already got job board access, no need to apply again.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.showModal(buildApplyModal());
      return;
    }

    // ── modal submit: grant role, forward the data, log it ──
    if (interaction.isModalSubmit() && interaction.customId === "apply_modal") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let member;
      try {
        member = await interaction.guild.members.fetch(interaction.user.id);
      } catch (err) {
        console.error("member fetch failed:", err.message);
        await interaction.editReply("something went wrong granting access, message ryan directly.");
        return;
      }

      if (FREE_VERIFIED_ROLE_ID && member.roles.cache.has(FREE_VERIFIED_ROLE_ID)) {
        await interaction.editReply("you've already got job board access, nothing else to do.");
        return;
      }

      const answers = {
        discord_id: interaction.user.id,
        discord_username: interaction.user.username,
        name: interaction.fields.getTextInputValue("name"),
        email: interaction.fields.getTextInputValue("email"),
        phone: interaction.fields.getTextInputValue("phone"),
        instagram: interaction.fields.getTextInputValue("instagram"),
        goal: interaction.fields.getTextInputValue("goal"),
      };

      try {
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
                  { name: "goal", value: answers.goal, inline: false }
                )
                .setColor(0x57f287)
                .setTimestamp(),
            ],
          });
        } catch (err) {
          console.error("staff log post failed:", err.message);
        }
      }

      console.log(
        `new applicant: ${answers.name} (${answers.email}) discord_id=${answers.discord_id}`
      );
      await interaction.editReply("you're in, job board access unlocked.");
      return;
    }
  } catch (err) {
    console.error("interaction handler error:", err);

    try {
      if (interaction.isRepliable()) {
        const msg = "something went wrong, message ryan directly.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      }
    } catch (_) {
      // interaction already expired, nothing more to do
    }
  }
});

// ── express ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => res.send("dialled community bot running"));
app.get("/health", (_, res) => res.json({ status: "ok" }));

// manual fallback, kept in case the button flow ever fails for someone
app.post("/api/verify-lead", async (req, res) => {
  if (!LEAD_WEBHOOK_API_KEY) {
    console.error("verify-lead called but LEAD_WEBHOOK_API_KEY is unset, refusing");
    return res.status(503).json({ error: "endpoint disabled" });
  }

  if (req.headers["x-api-key"] !== LEAD_WEBHOOK_API_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }

  const { discord_id } = req.body || {};
  if (!discord_id) return res.status(400).json({ error: "discord_id required" });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discord_id);

    if (FREE_VERIFIED_ROLE_ID && member.roles.cache.has(FREE_VERIFIED_ROLE_ID)) {
      return res.json({ success: true, already_had_role: true });
    }

    await member.roles.add(FREE_VERIFIED_ROLE_ID);
    res.json({ success: true });
  } catch (err) {
    console.error("verify-lead error:", err.message);
    res.status(500).json({ error: "could not assign role, check discord_id is correct" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ webhook listening on port ${PORT}`));

process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("discord login failed:", err.message);
  process.exit(1);
});
