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
