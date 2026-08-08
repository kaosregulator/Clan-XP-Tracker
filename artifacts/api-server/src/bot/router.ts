import type { Interaction } from "discord.js";
import { logger } from "../lib/logger";
import { parseId, NS } from "./ui/ids";
import {
  openSetup,
  handleSetupButton,
  handleSetupModal,
  handleSetupSelect,
} from "./features/setup";
import { handleXpCommand } from "./features/xp";
import { handleReviewButton } from "./features/review";
import { handleDashButton, handleDashSelect } from "./features/dashboard";
import { handleWarnings, handleHelp, handleWarnRemoveSelect } from "./features/misc";

/** Single entry point for every interaction. Thin dispatch by namespace/action. */
export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "setup":
          return void (await openSetup(interaction));
        case "xp":
        // Plain top-level aliases for the everyday actions — same handler.
        case "xpremind":
        case "xpwarn":
        case "entry":
        case "calendar":
        case "missing":
          return void (await handleXpCommand(interaction));
        case "warnings":
          return void (await handleWarnings(interaction));
        case "help":
          return void (await handleHelp(interaction));
      }
      return;
    }

    if (interaction.isButton()) {
      const { ns } = parseId(interaction.customId);
      switch (ns) {
        case NS.review:
          return void (await handleReviewButton(interaction));
        case NS.dash:
          return void (await handleDashButton(interaction));
        case NS.setup:
          return void (await handleSetupButton(interaction));
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupModal(interaction));
      return;
    }

    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupSelect(interaction));
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupSelect(interaction));
      if (ns === NS.dash) return void (await handleDashSelect(interaction));
      if (ns === NS.warn) return void (await handleWarnRemoveSelect(interaction));
      return;
    }
  } catch (err) {
    logger.error(
      {
        err,
        customId: "customId" in interaction ? interaction.customId : undefined,
      },
      "Interaction failed"
    );
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong. Please try again.", flags: 64 })
        .catch(() => {});
    }
  }
}
