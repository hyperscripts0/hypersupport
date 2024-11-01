require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const fs = require("fs"); // Ensure fs is imported if it's not already
const path = require("path"); // Require path module to handle file paths
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
});

const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const FEEDBACK_CHANNEL_ID = process.env.FEEDBACK_CHANNEL_ID;
const TRANSCRIPT_LOG_CHANNEL_ID = process.env.TRANSCRIPT_LOG_CHANNEL_ID;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;

let staffTickets = {}; // Tracks ticket counts for leaderboard
let ticketAssignments = {}; // Tracks active ticket assignments

// Load data on startup
function loadData() {
  if (fs.existsSync("./data/tickets.json")) {
    ticketAssignments = JSON.parse(
      fs.readFileSync("./data/tickets.json", "utf8")
    );
  } else {
    ticketAssignments = {};
  }

  if (fs.existsSync("./data/leaderboard.json")) {
    staffTickets =
      JSON.parse(fs.readFileSync("./data/leaderboard.json", "utf8"))
        .staffTickets || {};
  } else {
    staffTickets = {};
  }
}

function saveData() {
  try {
    if (ticketAssignments && Object.keys(ticketAssignments).length > 0) {
      fs.writeFileSync(
        "./data/tickets.json",
        JSON.stringify(ticketAssignments, null, 2)
      );
      console.log("ticketAssignments data saved to tickets.json.");
    } else {
      console.warn("No ticketAssignments data to save.");
    }

    if (staffTickets && Object.keys(staffTickets).length > 0) {
      fs.writeFileSync(
        "./data/leaderboard.json",
        JSON.stringify({ staffTickets }, null, 2)
      );
      console.log("staffTickets data saved to leaderboard.json.");
    } else {
      console.warn("No staffTickets data to save.");
    }
  } catch (error) {
    console.error("Error saving data to JSON files:", error);
  }
}


client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadData();
  await managePanelMessage();
  await updateLeaderboard();
  updateBotStatus();
});

async function managePanelMessage() {
  const panelChannel = await client.channels.fetch(PANEL_CHANNEL_ID);

  // Load panel data from JSON if it exists
  let panelData;
  if (fs.existsSync("./data/panel.json")) {
    try {
      panelData = JSON.parse(fs.readFileSync("./data/panel.json", "utf8"));
    } catch (error) {
      console.error("Error reading panel.json, initializing a new file:", error);
      panelData = { panelMessageId: null };
    }
  } else {
    panelData = { panelMessageId: null };
  }

  try {
    // Fetch recent messages in the panel channel
    const recentMessages = await panelChannel.messages.fetch({ limit: 10 });
    const panelMessages = recentMessages.filter(
      msg => msg.embeds[0]?.title === "🎟️ Ticket Support System"
    );

    // Delete all but the latest panel message
    if (panelMessages.size > 1) {
      const sortedMessages = panelMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const latestMessage = sortedMessages.first();

      for (const message of sortedMessages.values()) {
        if (message.id !== latestMessage.id && message.deletable) {
          await message.delete().catch(err => console.error("Failed to delete old panel message:", err));
        }
      }

      console.log("Deleted old panel messages to prevent spam.");
      panelData.panelMessageId = latestMessage.id;
      savePanelData(panelData); // Save updated data
      console.log("Updated panel message ID in JSON.");
      return;
    }

    // If exactly one panel message is found, save it as the active panel message ID
    if (panelMessages.size === 1) {
      const [existingMessage] = panelMessages.values();
      panelData.panelMessageId = existingMessage.id;
      savePanelData(panelData); // Save updated data
      console.log("Panel message found, not creating a new one.");
      return;
    }
  } catch (error) {
    console.error("Error while fetching panel messages:", error);
  }

  // If no panel message exists, create a new one
  const panelEmbed = new EmbedBuilder()
    .setTitle("🎟️ Ticket Support System")
    .setDescription("React with 🎟️ below to open a support ticket.")
    .setColor("#5865F2")
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: "HyperScripts | Customer Support" });

  const message = await panelChannel.send({ embeds: [panelEmbed] });
  message.react("🎟️");

  // Save the new panel message ID
  panelData.panelMessageId = message.id;
  savePanelData(panelData); // Save updated data
  console.log("New panel message created and saved.");
}

// Separate function to save panel data with confirmation
function savePanelData(data) {
  try {
    fs.writeFileSync("./data/panel.json", JSON.stringify(data, null, 2));
    console.log("panel.json file saved successfully.");
  } catch (error) {
    console.error("Error saving panel.json file:", error);
  }
}


client.on("messageReactionAdd", async (reaction, user) => {
  if (
    !user.bot &&
    reaction.message.channel.id === PANEL_CHANNEL_ID &&
    reaction.emoji.name === "🎟️"
  ) {
    await createTicket(reaction.message.guild, user);
    reaction.users.remove(user.id);
  }
});

async function createTicket(guild, user) {
  const staff = await findAvailableStaff(guild);

  if (!staff) {
    user.send("No available staff members right now. Please try again later.");
    return;
  }

  const ticketChannel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: 0,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      },
      {
        id: staff.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      },
    ],
  });

  ticketAssignments[ticketChannel.id] = {
    userId: user.id,
    staffId: staff.id,
    status: "open",
  };

  if (!staffTickets[staff.id]) staffTickets[staff.id] = 0;
  staffTickets[staff.id]++;

  saveData();

  const ticketEmbed = new EmbedBuilder()
    .setTitle("📩 Support Ticket")
    .setDescription(
      "A staff member will assist you shortly.\nWhen you are done, click the **Close Ticket** button below."
    )
    .setColor("#5865F2")
    .setThumbnail(guild.iconURL())
    .setFooter({ text: `Ticket created by ${user.tag}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Primary)
  );

  ticketChannel.send({
    content: `<@${staff.id}>`,
    embeds: [ticketEmbed],
    components: [row],
  });
  updateBotStatus();
}

async function findAvailableStaff(guild) {
  const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
  if (!staffRole) return null;

  const onlineStaff = staffRole.members.filter((member) =>
    ["online", "dnd", "idle"].includes(member.presence?.status)
  );

  let selectedStaff = null;
  let minTickets = Infinity;

  for (const [id, member] of onlineStaff) {
    const ticketCount = staffTickets[id] || 0;
    if (ticketCount < minTickets) {
      minTickets = ticketCount;
      selectedStaff = member;
    }
  }

  return selectedStaff;
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === "close_ticket") {
      await handleCloseTicket(interaction);
    } else if (interaction.customId === "provide_feedback") {
      openFeedbackModal(interaction);
    }
  } else if (
    interaction.isModalSubmit() &&
    interaction.customId === "feedback_modal"
  ) {
    await handleFeedbackSubmission(interaction);
  }
});

async function handleCloseTicket(interaction) {
  try {
    await interaction.deferUpdate();

    const ticketInfo = ticketAssignments[interaction.channel.id];
    if (!ticketInfo) {
      console.error("Ticket assignment not found for this channel when attempting to close.");
      return;
    }

    const userId = ticketInfo.userId; // Store userId
    delete ticketAssignments[interaction.channel.id]; // Remove ticket from active assignments
    saveData();

    interaction.channel.permissionOverwrites.edit(interaction.user, {
      SendMessages: false,
    });

    const feedbackEmbed = new EmbedBuilder()
      .setTitle("📝 Feedback Request")
      .setDescription("Please provide feedback by clicking the button below.")
      .setColor("#FFA500")
      .setFooter({ text: "HyperScripts | Customer Feedback" });

    const feedbackButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("provide_feedback")
        .setLabel("Provide Feedback")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({
      embeds: [feedbackEmbed],
      components: [feedbackButton],
    });

    // Do NOT call finalizeTicketClosure here
  } catch (error) {
    console.error("Error handling close ticket interaction:", error);
  }
}


function openFeedbackModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("feedback_modal")
    .setTitle("Feedback on Support Ticket");

  const ratingInput = new TextInputBuilder()
    .setCustomId("rating")
    .setLabel("Rate our support (1-5 stars)")
    .setPlaceholder("Enter a number from 1 to 5")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const commentsInput = new TextInputBuilder()
    .setCustomId("comments")
    .setLabel("Additional Feedback")
    .setPlaceholder("Type your feedback here")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(ratingInput),
    new ActionRowBuilder().addComponents(commentsInput)
  );

  interaction.showModal(modal);
}

async function handleFeedbackSubmission(interaction) {
  try {
    console.log("Feedback modal submitted. Starting to process feedback...");

    // Acknowledge the modal submission immediately to avoid timeout errors
    await interaction.deferReply({ ephemeral: true });
    console.log("Modal interaction deferred.");

    const rating = interaction.fields.getTextInputValue("rating");
    const comments = interaction.fields.getTextInputValue("comments") || "No additional comments provided.";

    const feedback = {
      ticketId: interaction.channel.id,
      userId: interaction.user.id,
      rating: rating,
      comment: comments,
    };

    // Save feedback to file
    saveFeedback(feedback);
    console.log("Feedback saved locally.");

    // Send feedback to designated feedback channel
    await sendFeedbackToChannel(interaction.guild, feedback);
    console.log("Feedback sent to feedback channel.");

    // Follow up to thank the user and inform about channel deletion
    await interaction.followUp({
      content: "Thank you for your feedback! The ticket will now be closed and deleted.",
      ephemeral: true,
    });
    console.log("Follow-up message sent to user.");

    // Call finalizeTicketClosure to handle transcript generation, sending, and deletion
    await finalizeTicketClosure(interaction, interaction.user.id);
    console.log("Finalized ticket closure.");
  } catch (error) {
    console.error("Error handling feedback submission:", error);
    await interaction.followUp({
      content: "An error occurred while processing your feedback. Please try again later.",
      ephemeral: true,
    });
  }
}


function saveFeedback(feedback) {
  let feedbackData;
  try {
    feedbackData = JSON.parse(fs.readFileSync("./data/feedback.json", "utf8"));
  } catch (error) {
    console.error("Could not read feedback.json, initializing a new array.");
    feedbackData = [];
  }

  feedbackData.push(feedback);
  fs.writeFileSync(
    "./data/feedback.json",
    JSON.stringify(feedbackData, null, 2)
  );
  console.log("Feedback saved to feedback.json.");
}

async function sendFeedbackToChannel(guild, feedback) {
  try {
    const feedbackChannel = guild.channels.cache.get(FEEDBACK_CHANNEL_ID);
    if (!feedbackChannel) {
      console.error(
        "Feedback channel not found. Please check FEEDBACK_CHANNEL_ID."
      );
      return;
    }

    // Fetch the user who submitted the feedback to get their profile picture
    const user = await guild.members.fetch(feedback.userId);

    const feedbackEmbed = new EmbedBuilder()
      .setTitle("✨ User Feedback")
      .setDescription(
        `Feedback received from a recently closed support ticket.`
      )
      .addFields(
        {
          name: "🌟 Rating",
          value: `${"⭐".repeat(feedback.rating)} (${feedback.rating} stars)`,
          inline: true,
        },
        {
          name: "💬 Comments",
          value: feedback.comment || "No additional comments provided.",
        }
      )
      .setThumbnail(user.user.displayAvatarURL({ dynamic: true })) // User's profile picture
      .setFooter({
        text: `Submitted by ${user.user.tag}`,
        iconURL: user.user.displayAvatarURL({ dynamic: true }),
      })
      .setTimestamp()
      .setColor("#FFD700");

    // Optional: Add a custom thumbnail image if available
    const customThumbnailUrl =
      "https://media.discordapp.net/attachments/1301432630750744597/1301812824909025332/KIA_ZONE_GAMING-min.png"; // Replace with the actual URL or use an environment variable
    if (customThumbnailUrl) {
      feedbackEmbed.setImage(customThumbnailUrl);
    }

    await feedbackChannel.send({ embeds: [feedbackEmbed] });
    console.log(
      `Feedback sent for ticket ${feedback.ticketId} to channel ${FEEDBACK_CHANNEL_ID}`
    );
  } catch (error) {
    console.error("Error sending feedback to channel:", error);
  }
}

async function finalizeTicketClosure(interaction, userId) {
  try {
    console.log("Starting ticket closure...");

    // Generate the transcript
    const transcriptFilePath = await generateTranscript(interaction.channel);

    if (transcriptFilePath) {
      console.log(`Transcript file generated at: ${transcriptFilePath}`);

      // Fetch the user and send the transcript if the user fetch is successful
      let user;
      try {
        user = await interaction.guild.members.fetch(userId);
        if (user) {
          await user.send({
            content: "Here’s the transcript for your closed ticket:",
            files: [transcriptFilePath],
          });
          console.log(`Transcript sent to user ${user.user.tag}`);
        }
      } catch (error) {
        if (error.code === 'GuildMembersTimeout') {
          console.warn("Fetching guild member timed out, skipping DM transcript.");
        } else {
          console.error("Unexpected error fetching guild member:", error);
        }
      }

      // Send the transcript to the transcript log channel
      const transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
      if (transcriptChannel) {
        try {
          await transcriptChannel.send({
            content: `Transcript for the closed ticket:`,
            files: [transcriptFilePath],
          });
          console.log("Transcript sent to transcript log channel.");
        } catch (error) {
          console.error("Failed to send transcript to transcript log channel:", error);
        }
      } else {
        console.warn("Transcript log channel not found or unavailable.");
      }
    } else {
      console.warn("No transcript generated, or the file path is invalid.");
    }

    // Ensure the ticket channel exists before attempting deletion
    if (interaction.channel) {
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
          console.log("Ticket channel successfully deleted.");
        } catch (error) {
          console.error("Failed to delete the ticket channel:", error);
        }
      }, 5000); // 5-second delay for smooth deletion
    } else {
      console.warn("Ticket channel already deleted or does not exist.");
    }

    // Update the leaderboard after channel deletion
    await updateLeaderboard();
    console.log("Leaderboard updated after ticket closure.");
  } catch (error) {
    console.error("Error finalizing ticket closure:", error);
  }
}


async function generateTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 }); // Fetch the last 100 messages
    const transcriptContent = messages
      .map(msg => `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content}`)
      .reverse() // Reverse to display in chronological order
      .join('\n');

    const transcriptDirectory = path.join(__dirname, 'transcripts');
    const transcriptFilePath = path.join(transcriptDirectory, `transcript-${channel.id}.txt`);

    // Ensure the transcripts directory exists
    if (!fs.existsSync(transcriptDirectory)) {
      fs.mkdirSync(transcriptDirectory, { recursive: true });
    }

    // Save transcript to a file with a check to confirm the save
    fs.writeFileSync(transcriptFilePath, transcriptContent);
    if (fs.existsSync(transcriptFilePath)) {
      console.log(`Transcript saved for channel ${channel.id} at ${transcriptFilePath}`);
      return transcriptFilePath; // Return the path to the saved transcript
    } else {
      throw new Error("Transcript file was not saved properly.");
    }
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
}


async function updateLeaderboard() {
  const leaderboardData = Object.entries(staffTickets)
    .sort(([, a], [, b]) => b - a) // Sort by number of tickets handled in descending order
    .slice(0, 5) // Get the top 5 staff members
    .map(
      ([id, tickets], index) => `${index + 1}. <@${id}> - ${tickets} tickets`
    );

  const leaderboardEmbed = new EmbedBuilder()
    .setTitle("🏆 Top 5 Most Active Ticket Staff")
    .setDescription(leaderboardData.join("\n") || "No activity yet.")
    .setColor("#FFD700")
    .setFooter({ text: "Updated every time a ticket is closed." });

  const leaderboardChannel = await client.channels.fetch(
    LEADERBOARD_CHANNEL_ID
  );

  let leaderboardMessageId;
  try {
    // Load existing message ID for the leaderboard from file
    const leaderboardDataFile = JSON.parse(
      fs.readFileSync("./data/leaderboard.json", "utf8")
    );
    leaderboardMessageId = leaderboardDataFile.messageId;
  } catch (error) {
    leaderboardMessageId = null;
  }

  try {
    if (leaderboardMessageId) {
      // Try to fetch and edit the existing leaderboard message
      const oldMessage = await leaderboardChannel.messages.fetch(
        leaderboardMessageId
      );
      await oldMessage.edit({ embeds: [leaderboardEmbed] });
    } else {
      // If no message ID exists, send a new message and save its ID
      const message = await leaderboardChannel.send({
        embeds: [leaderboardEmbed],
      });
      leaderboardMessageId = message.id;
      fs.writeFileSync(
        "./data/leaderboard.json",
        JSON.stringify(
          { staffTickets, messageId: leaderboardMessageId },
          null,
          2
        )
      );
    }
  } catch (error) {
    console.log("Could not edit old leaderboard message, sending a new one.");
    const message = await leaderboardChannel.send({
      embeds: [leaderboardEmbed],
    });
    leaderboardMessageId = message.id;
    fs.writeFileSync(
      "./data/leaderboard.json",
      JSON.stringify({ staffTickets, messageId: leaderboardMessageId }, null, 2)
    );
  }
}

function updateBotStatus() {
  const totalOpenTickets = Object.keys(ticketAssignments).length;
  client.user.setActivity(`Handling ${totalOpenTickets} tickets`, {
    type: "WATCHING",
  });
}

client.login(process.env.DISCORD_TOKEN);