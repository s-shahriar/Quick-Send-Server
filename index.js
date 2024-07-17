const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://mfs-project-d9f9e.web.app",
    "https://mfs-project-d9f9e.firebaseapp.com",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

const CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wpwwlgm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const allUsers = client.db("mfsDB").collection("allUsers");
    const transactions = client.db("mfsDB").collection("transactions");
    const requests = client.db("mfsDB").collection("requests");

    // jwt generate
    app.post("/jwt", async (req, res) => {
      try {
        const email = req.body;
        const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        res.send({ token });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Token generation failed" });
      }
    });

    // verify token
    const verifyToken = (req, res, next) => {
      const authorizationToken = req.headers.authorization;
      if (!authorizationToken) {
        return res.status(401).send({
          message: "You are not authorized to access this route.",
        });
      }
      const userToken = req.headers.authorization.split(" ")[1];
      jwt.verify(userToken, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Clear token on logout
    app.get("/logout", (req, res) => {
      try {
        res.clearCookie("token", { ...CookieOptions, maxAge: 0 });
        res.status(200).send({ success: true });
      } catch (error) {
        res.status(500).send({ success: false, error: "Logout failed" });
      }
    });

    //register
    app.post("/register", async (req, res) => {
      const { name, pin, mobileNumber, email, role } = req.body;

      // Hash the PIN
      const saltRounds = 10;
      const hashedPin = await bcrypt.hash(pin, saltRounds);

      // Create the user object
      const newUser = {
        name,
        email,
        mobileNumber,
        pinHash: hashedPin,
        role: role,
        status: "pending",
        balance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      try {
        // Insert the new user into the database
        const result = await allUsers.insertOne(newUser);
        res.status(201).send({ message: "User registered successfully" });
      } catch (error) {
        res.status(500).send({ message: "Error registering user", error });
      }
    });

    // get email for login
    app.post("/get-email", async (req, res) => {
      const { mobileNumber } = req.body;

      try {
        const user = await allUsers.findOne({ mobileNumber });
        if (user) {
          return res.status(200).json({ email: user.email });
        } else {
          return res.status(404).json({ error: "User not found" });
        }
      } catch (error) {
        return res.status(500).json({ error: "Server error" });
      }
    });

    // user info extract
    app.get("/users/:email", async (req, res) => {
      const { email } = req.params;

      try {
        const user = await allUsers.findOne({ email });
        if (user) {
          return res.status(200).json(user);
        } else {
          return res.status(404).json({ error: "User not found" });
        }
      } catch (error) {
        return res.status(500).json({ error: "Server error" });
      }
    });

    // user -> send money
    app.post("/send-money", verifyToken, async (req, res) => {
      const { recipientMobileNumber, amount, pin } = req.body;
      try {
        const userEmail = req.decoded.email;
        // Find the sender and recipient
        const sender = await allUsers.findOne({ email: userEmail });
        const recipient = await allUsers.findOne({
          mobileNumber: recipientMobileNumber,
        });

        if (!sender) {
          return res.status(400).send({ message: "Sender not found" });
        }

        if (!recipient) {
          return res.status(400).send({ message: "Recipient not found" });
        }

        // Verify sender's PIN
        const isPinValid = await bcrypt.compare(pin, sender.pinHash);

        if (!isPinValid) {
          return res.status(400).send({ message: "Invalid PIN" });
        }

        // Calculate the transaction fee
        let fee = 0;
        if (amount > 100) {
          fee = 5;
        }

        const totalAmount = parseInt(+amount + +fee);

        // Check if the sender has enough balance
        if (sender.balance < totalAmount) {
          return res.status(400).send({ message: "Insufficient balance" });
        }

        // Update balances and record the transaction
        try {
          // Deduct amount from sender's balance
          const userBalance = await allUsers.updateOne(
            { _id: new Object(sender._id) },
            { $inc: { balance: -totalAmount } }
          );

          // Add amount to recipient's balance
          const receiverBalance = await allUsers.updateOne(
            { _id: new Object(recipient._id) },
            { $inc: { balance: parseInt(amount) } }
          );

          // Record the transaction
          const transaction = {
            type: "sendMoney",
            amount,
            fee,
            fromUser: sender._id,
            toUser: recipient._id,
            timestamp: new Date(),
          };

          const result = await transactions.insertOne(transaction);


          if (result.acknowledged) {
            res.send({ message: "Money sent successfully" });
          } else {
            res.status(500).send({ message: "Error recording transaction" });
          }
        } catch (error) {
          res.status(500).send({ message: "Error updating balances", error });
        }
      } catch (error) {
        res.status(500).send({ message: "Error sending money", error });
      }
    });

    // USER -> Cash Out Request via Agent
    app.post("/cash-out", verifyToken, async (req, res) => {
      const { agentMobileNumber, amount, pin } = req.body;

      // Validate inputs
      if (!agentMobileNumber || !amount || !pin) {
        return res.status(400).send({
          message: "Agent mobile number, amount, and PIN are required",
        });
      }

      try {
        const userEmail = req.decoded.email;

        // Find the user and agent
        const user = await allUsers.findOne({ email: userEmail });
        const agent = await allUsers.findOne({
          mobileNumber: agentMobileNumber,
          role: "agent",
        });

        if (!user) {
          return res.status(400).send({ message: "User not found" });
        }

        if (!agent) {
          return res.status(400).send({ message: "Agent not found" });
        }

        // Verify user's PIN
        const isPinValid = await bcrypt.compare(pin, user.pinHash);
        if (!isPinValid) {
          return res.status(400).send({ message: "Invalid PIN" });
        }

        // Check if the user has enough balance
        if (user.balance < amount) {
          return res.status(400).send({ message: "Insufficient balance" });
        }

        // Create a cash-out request
        const request = {
          userId: user._id,
          agentId: agent._id,
          type: "Cash Out",
          amount: parseInt(amount),
          status: "pending",
          timestamp: new Date(),
        };

        const result = await requests.insertOne(request);

        if (result.acknowledged) {
          res.send({ message: "Cash-out request created successfully" });
        } else {
          res.status(500).send({ message: "Error creating cash-out request" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error processing cash-out request", error });
      }
    });

    // user --> cash-in request
    app.post("/cash-in", verifyToken, async (req, res) => {
      const { agentMobileNumber, amount, pin } = req.body;

      // Validate inputs
      if (!agentMobileNumber || !amount || !pin) {
        return res.status(400).send({
          message: "Agent mobile number, amount, and PIN are required",
        });
      }

      try {
        const userEmail = req.decoded.email;

        // Find the user and agent
        const user = await allUsers.findOne({ email: userEmail });
        const agent = await allUsers.findOne({
          mobileNumber: agentMobileNumber,
          role: "agent",
        });

        if (!user) {
          return res.status(400).send({ message: "User not found" });
        }

        if (!agent) {
          return res.status(400).send({ message: "Agent not found" });
        }

        // Verify user's PIN
        const isPinValid = await bcrypt.compare(pin, user.pinHash);
        if (!isPinValid) {
          return res.status(400).send({ message: "Invalid PIN" });
        }

        // Create a cash-in request
        const request = {
          userId: user._id,
          agentId: agent._id,
          type: "Cash In",
          amount: parseInt(amount),
          status: "pending",
          timestamp: new Date(),
        };

        const result = await requests.insertOne(request);

        if (result.acknowledged) {
          res.send({ message: "Cash-in request created successfully" });
        } else {
          res.status(500).send({ message: "Error creating cash-in request" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error processing cash-in request", error });
      }
    });

    // agent --> request retrive
    app.get("/requests", verifyToken, async (req, res) => {
      try {
        const requestsList = await requests.find().toArray();
        res.send(requestsList);
      } catch (error) {
        res.status(500).send({ message: "Error fetching requests", error });
      }
    });

    // agent --> transaction management
    app.post("/manage-transaction", verifyToken, async (req, res) => {
      const { requestId, action } = req.body; // action can be "approve" or "deny"

      try {
        const request = await requests.findOne({
          _id: new ObjectId(requestId),
        });

        if (!request) {
          return res.status(404).send({ message: "Request not found" });
        }

        if (request.status !== "pending") {
          return res
            .status(400)
            .send({ message: "Request has already been processed" });
        }

        // Find the user and agent
        const user = await allUsers.findOne({
          _id: new ObjectId(request.userId),
        });
        const agent = await allUsers.findOne({
          _id: new ObjectId(request.agentId),
        });

        if (!user || !agent) {
          return res.status(404).send({ message: "User or agent not found" });
        }

        if (action === "approve") {
          if (request.type === "Cash In") {
            // Check if the agent has enough balance for the cash-in

            if (agent.balance < request.amount) {
              return res
                .status(400)
                .send({ message: "Insufficient balance in agent account" });
            }

            // Update balances
            await allUsers.updateOne(
              { _id: agent._id },
              { $inc: { balance: -request.amount } }
            );

            await allUsers.updateOne(
              { _id: user._id },
              { $inc: { balance: request.amount } }
            );
          } else if (request.type === "Cash Out") {
            // Update balances
            await allUsers.updateOne(
              { _id: new Object(user._id) },
              { $inc: { balance: -request.amount } }
            );

            await allUsers.updateOne(
              { _id: new Object(agent._id) },
              { $inc: { balance: +request.amount } }
            );
          } else {
            return res
              .status(400)
              .send({ message: "Invalid transaction type" });
          }

          // Record the transaction
          const transaction = {
            type: request.type,
            amount: request.amount,
            fromUser: request.type === "cashIn" ? agent._id : user._id,
            toUser: request.type === "cashIn" ? user._id : agent._id,
            timestamp: new Date(),
          };

          const result = await transactions.insertOne(transaction);

          if (!result.acknowledged) {
            throw new Error("Failed to record transaction");
          }

          // Update request status
          await requests.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status: "approved" } }
          );

          res.send({
            message: "Transaction approved and completed successfully",
          });
        } else if (action === "deny") {
          // Update request status
          await requests.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status: "denied" } }
          );

          res.send({ message: "Transaction denied successfully" });
        } else {
          res.status(400).send({ message: "Invalid action" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error managing transaction", error });
      }
    });

    // Fetch all users - transaction management + history
    app.get("/all-users", verifyToken, async (req, res) => {
      try {
        const allUsersInfo = await allUsers.find({}).toArray();
    
        const users = allUsersInfo.map((user) => ({
          _id: user._id,
          name: user.name,
          email: user.email, 
        }));
    
        res.send(users);
      } catch (error) {
        console.error("Error fetching all users:", error);
        res.status(500).send({ message: "Error fetching users" });
      }
    });
    

    // Transaction history
    app.get("/transaction-history", verifyToken, async (req, res) => {
      try {
        const userEmail = req.decoded.email;
        let transactionsList;

        if (userEmail === "admin@admin.com") {
          transactionsList = await transactions
            .find({})
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();
        } else {
          const user = await allUsers.findOne({ email: userEmail });

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const userId = user._id;
          transactionsList = await transactions
            .find({
              $or: [{ fromUser: userId }, { toUser: userId }],
            })
            .sort({ timestamp: -1 })
            .limit(100)
            .toArray();
        }

        res.send(transactionsList);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error fetching transaction history", error });
      }
    });

    // Admin --> Get user list
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const users = await allUsers.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    // Admin --> manage user

    app.patch('/manage-user', verifyToken, async (req, res) => {
      const { userId, action } = req.body;
    
      try {
        const user = await allUsers.findOne({ _id: new ObjectId(userId) });
    
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }
    
        let updateFields = {};
        let incrementFields = {};
    
        if (action === 'activate' && user.status === 'pending') {
          updateFields.status = 'approved';
          if (!user.bonusGiven) {
            updateFields.bonusGiven = true;
            incrementFields.balance = user.role === 'user' ? 40 : (user.role === 'agent' ? 10000 : 0);
          }
        } else if (action === 'block' && user.status !== 'blocked') {
          updateFields.status = 'blocked';
        } else if (action === 'activate' && user.status === 'blocked') {
          updateFields.status = 'approved';
        } else {
          return res.status(400).send({ message: 'Invalid action or user is already active' });
        }
    
        await allUsers.updateOne(
          { _id: user._id },
          { $set: { ...updateFields, updatedAt: new Date() }, $inc: incrementFields }
        );
    
        res.send({ message: `User ${action === 'activate' ? 'activated' : 'blocked'} successfully` });
      } catch (error) {
        res.status(500).send({ message: 'Error managing user', error });
      }
    });
    
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
