import { MessageFlags } from "discord.js";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "./types.ts";
import { getSettings, updateSettings } from "../../game/guilds.ts";
import { nowS, previousUtcDay } from "../../util/time.ts";
import { postLeaderboardForGuild, postIdleDigestForGuild } from "../../scheduler.ts";

const ROLE_LEVELS = ["5", "10", "25", "50"];

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Admin configuration")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("channel-weight")
        .setDescription("Set a channel's XP weight (default 1.0)")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
        )
        .addNumberOption((o) =>
          o.setName("weight").setDescription("Multiplier, e.g. 1.5").setRequired(true).setMinValue(0).setMaxValue(5),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("role-reward")
        .setDescription("Set the role granted at a level milestone")
        .addStringOption((o) =>
          o
            .setName("level")
            .setDescription("Milestone")
            .setRequired(true)
            .addChoices(
              { name: "Level 5", value: "5" },
              { name: "Level 10", value: "10" },
              { name: "Level 25", value: "25" },
              { name: "Level 50", value: "50" },
            ),
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("leaderboard-channel")
        .setDescription("Where to post the daily leaderboard (00:00 UTC)")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("idle-digest")
        .setDescription("Set (or clear) the opt-in daily idle-digest channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to post the digest to; omit to disable")
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) =>
      s.setName("post-leaderboard").setDescription("Post yesterday's leaderboard now (test the daily job)"),
    )
    .addSubcommand((s) =>
      s.setName("post-digest").setDescription("Post the idle digest now (test the daily job)"),
    )
    .addSubcommand((s) => s.setName("show").setDescription("Show current configuration")),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === "channel-weight") {
      const channel = interaction.options.getChannel("channel", true);
      const weight = interaction.options.getNumber("weight", true);
      updateSettings(guildId, (s) => {
        s.channel_weights ??= {};
        s.channel_weights[channel.id] = weight;
      });
      await interaction.reply({ content: `✅ <#${channel.id}> XP weight set to **${weight}×**.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === "role-reward") {
      const level = interaction.options.getString("level", true);
      const role = interaction.options.getRole("role", true);
      updateSettings(guildId, (s) => {
        s.role_rewards ??= {};
        s.role_rewards[level] = role.id;
      });
      await interaction.reply({ content: `✅ Level ${level} now grants <@&${role.id}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === "leaderboard-channel") {
      const channel = interaction.options.getChannel("channel", true);
      updateSettings(guildId, (s) => {
        s.leaderboard_channel_id = channel.id;
      });
      await interaction.reply({
        content: `✅ Daily leaderboard will post to <#${channel.id}> at 00:00 UTC.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "idle-digest") {
      const channel = interaction.options.getChannel("channel");
      updateSettings(guildId, (s) => {
        if (channel) s.idle_digest_channel_id = channel.id;
        else delete s.idle_digest_channel_id;
      });
      await interaction.reply({
        content: channel
          ? `✅ Daily idle digest will post to <#${channel.id}> at 00:00 UTC.`
          : "✅ Daily idle digest disabled.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "post-leaderboard") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const now = nowS();
      const day = previousUtcDay(now);
      const posted = await postLeaderboardForGuild(interaction.client, guildId, day, now);
      await interaction.editReply(
        posted
          ? `✅ Posted the ${day} leaderboard.`
          : "⚠️ No leaderboard channel set (use `/config leaderboard-channel`) or no activity for that day.",
      );
      return;
    }

    if (sub === "post-digest") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const posted = await postIdleDigestForGuild(interaction.client, guildId);
      await interaction.editReply(
        posted
          ? "✅ Posted the idle digest."
          : "⚠️ No digest channel set (use `/config idle-digest`) or nobody has idle gold waiting.",
      );
      return;
    }

    // show
    const s = getSettings(guildId);
    const weights = s.channel_weights
      ? Object.entries(s.channel_weights).map(([c, w]) => `<#${c}>: ${w}×`).join("\n")
      : "_none_";
    const roles = s.role_rewards
      ? ROLE_LEVELS.filter((l) => s.role_rewards![l]).map((l) => `L${l}: <@&${s.role_rewards![l]}>`).join("\n")
      : "_none_";
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("⚙️ Guild Configuration")
          .setColor(0x5865f2)
          .addFields(
            { name: "Leaderboard channel", value: s.leaderboard_channel_id ? `<#${s.leaderboard_channel_id}>` : "_unset_" },
            { name: "Idle digest channel", value: s.idle_digest_channel_id ? `<#${s.idle_digest_channel_id}>` : "_unset_" },
            { name: "Channel weights", value: weights },
            { name: "Role rewards", value: roles },
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
