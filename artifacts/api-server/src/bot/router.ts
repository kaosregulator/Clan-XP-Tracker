import type { Interaction } from "discord.js";
import { logger } from "../lib/logger";
import { parseId, NS } from "./ui/ids";
import { openSetup, handleSetupButton, handleSetupModal, handleSetupSelect } from "./features/setup";
import { sendMemberHub, handleXpButton } from "./features/hub";
import { sendAdminHub, handleAdminButton } from "./features/adminHub";
import {
  handleProfile,
  handleLeaderboard,
  handleWarnings,
  handleReport,
  handleWarnRemoveSelect,
} from "./features/misc";
import {
  handleAddAccountModal,
  handleRemoveAccountSelect,
  handleSubmitAccountSelect,
} from "./features/accounts";
import {
  handleApprove,
  handleRejectButton,
  handleRejectModal,
  handleRemind,
  handleWarnButton,
  handleWarnModal,
  handleHistory,
} from "./features/review";

/** Single entry point for every interaction. Thin dispatch by namespace/action. */
export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "setup":
          return void (await openSetup(interaction));
        case "xp":
          return void (await sendMemberHub(interaction));
        case "xpadmin":
          return void (await sendAdminHub(interaction));
        case "profile":
          return void (await handleProfile(interaction));
        case "leaderboard":
          return void (await handleLeaderboard(interaction));
        case "warnings":
          return void (await handleWarnings(interaction));
        case "report":
          return void (await handleReport(interaction));
      }
      return;
    }

    if (interaction.isButton()) {
      const { ns, action } = parseId(interaction.customId);
      switch (ns) {
        case NS.xp:
          return void (await handleXpButton(interaction));
        case NS.admin:
          return void (await handleAdminButton(interaction));
        case NS.setup:
          return void (await handleSetupButton(interaction));
        case NS.review:
          switch (action) {
            case "approve":
              return void (await handleApprove(interaction));
            case "reject":
              return void (await handleRejectButton(interaction));
            case "remind":
              return void (await handleRemind(interaction));
            case "warn":
              return void (await handleWarnButton(interaction));
            case "history":
              return void (await handleHistory(interaction));
          }
          return;
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const { ns, action } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupModal(interaction));
      if (ns === NS.xp && action === "addAccountModal")
        return void (await handleAddAccountModal(interaction));
      if (ns === NS.review) {
        if (action === "rejectModal") return void (await handleRejectModal(interaction));
        if (action === "warnModal") return void (await handleWarnModal(interaction));
      }
      return;
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupSelect(interaction));
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const { ns, action } = parseId(interaction.customId);
      if (ns === NS.warn) return void (await handleWarnRemoveSelect(interaction));
      if (ns === NS.xp) {
        if (action === "removeAccount") return void (await handleRemoveAccountSelect(interaction));
        if (action === "submitAccount") return void (await handleSubmitAccountSelect(interaction));
      }
      return;
    }
  } catch (err) {
    logger.error({ err, customId: "customId" in interaction ? interaction.customId : undefined }, "Interaction failed");
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong. Please try again.", flags: 64 })
        .catch(() => {});
    }
  }
}
