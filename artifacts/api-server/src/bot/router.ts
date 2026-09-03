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
import { handleHelp, handleWarnRemoveSelect } from "./features/misc";
import { handleWarnings, handleHubButton, handleHubModal } from "./features/userHub";
import {
  openCommandCenter,
  handleCommandCenterButton,
  handleCommandCenterSelect,
} from "./features/commandCenter";
import { openNotifications, handleNotifButton, handleNotifSelect } from "./features/notifications";
import {
  openDisputeCommand,
  openDisputeReview,
  handleDisputeButton,
  handleDisputeSelect,
  handleDisputeReasonModal,
} from "./features/disputes";
import { openTickets, handleTicketButton, handleTicketSelect } from "./features/tickets";
import { handleMemberPanelButton, handleMemberPanelModal } from "./features/memberPanel";
import { handleAuditButton } from "./features/audit";
import {
  openEnforcementPicker,
  handleEnforcementButton,
  handleEnforcementSelect,
  handleEnforcementNoteModal,
} from "./features/enforcementPicker";
import {
  handleRobloxCommand,
  handleMilitaryCommand,
  handleRobloxAutocomplete,
  handleRobloxButton,
  handleRobloxSelect,
  handleRobloxModal,
} from "./features/robloxHub";
import {
  handleScoutCommand,
  handleScoutAutocomplete,
  handleScoutButton,
  handleScoutSelect,
  handleScoutModal,
} from "./features/scoutHub";
import {
  handleMarketCommand,
  handleMarketButton,
  handleMarketSelect,
  handleMarketModal,
} from "./features/marketHub";

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
        case "entry":
        case "calendar":
        case "missing":
          return void (await handleXpCommand(interaction));
        // Unified reminder/warning picker (consolidates the old /xpwarn).
        case "xpreminder":
        case "xpwarn":
          return void (await openEnforcementPicker(interaction));
        case "warnings":
          return void (await handleWarnings(interaction));
        case "help":
          return void (await handleHelp(interaction));
        case "panel":
          return void (await openCommandCenter(interaction));
        case "notifications":
          return void (await openNotifications(interaction));
        case "dispute":
          return void (await openDisputeCommand(interaction));
        case "disputes":
          return void (await openDisputeReview(interaction));
        case "tickets":
          return void (await openTickets(interaction));
        case "roblox":
          return void (await handleRobloxCommand(interaction));
        case "military":
          return void (await handleMilitaryCommand(interaction));
        case "scout":
          return void (await handleScoutCommand(interaction));
        case "market":
          return void (await handleMarketCommand(interaction));
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "roblox" || interaction.commandName === "military") {
        return void (await handleRobloxAutocomplete(interaction));
      }
      if (interaction.commandName === "scout") {
        return void (await handleScoutAutocomplete(interaction));
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
        case NS.cc:
          return void (await handleCommandCenterButton(interaction));
        case NS.notif:
          return void (await handleNotifButton(interaction));
        case NS.disp:
          return void (await handleDisputeButton(interaction));
        case NS.tkt:
          return void (await handleTicketButton(interaction));
        case NS.mp:
          return void (await handleMemberPanelButton(interaction));
        case NS.aud:
          return void (await handleAuditButton(interaction));
        case NS.hub:
          return void (await handleHubButton(interaction));
        case NS.enf:
          return void (await handleEnforcementButton(interaction));
        case NS.rbx:
          return void (await handleRobloxButton(interaction));
        case NS.scout:
          return void (await handleScoutButton(interaction));
        case NS.mkt:
          return void (await handleMarketButton(interaction));
      }
      return;
    }

    if (interaction.isUserSelectMenu()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.cc) return void (await handleCommandCenterSelect(interaction));
      if (ns === NS.setup) return void (await handleSetupSelect(interaction));
      if (ns === NS.enf) return void (await handleEnforcementSelect(interaction));
      return;
    }

    if (interaction.isModalSubmit()) {
      const { ns } = parseId(interaction.customId);
      if (ns === NS.setup) return void (await handleSetupModal(interaction));
      if (ns === NS.disp) return void (await handleDisputeReasonModal(interaction));
      if (ns === NS.mp) return void (await handleMemberPanelModal(interaction));
      if (ns === NS.enf) return void (await handleEnforcementNoteModal(interaction));
      if (ns === NS.hub) return void (await handleHubModal(interaction));
      if (ns === NS.rbx) return void (await handleRobloxModal(interaction));
      if (ns === NS.scout) return void (await handleScoutModal(interaction));
      if (ns === NS.mkt) return void (await handleMarketModal(interaction));
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
      if (ns === NS.notif) return void (await handleNotifSelect(interaction));
      if (ns === NS.disp) return void (await handleDisputeSelect(interaction));
      if (ns === NS.tkt) return void (await handleTicketSelect(interaction));
      if (ns === NS.rbx) return void (await handleRobloxSelect(interaction));
      if (ns === NS.scout) return void (await handleScoutSelect(interaction));
      if (ns === NS.mkt) return void (await handleMarketSelect(interaction));
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
