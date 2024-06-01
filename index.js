const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://libhub-46f8c.web.app",
    "https://libhub-46f8c.firebaseapp.com",
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

// verify jwt middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Token error: Token not found" });
  }
  console.log("token found");
  if (token) {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        console.log("token ERROR");
        return res
          .status(401)
          .send({ message: "Token authentication error", error: err.message });
      }
      req.user = decoded;
      next();
    });
  }
};

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
    const assetsCollection = client.db("assetMartDB").collection("assets");
    const userCollection = client.db("assetMartDB").collection("users");

    // jwt generate

    app.post("/jwt", async (req, res) => {
      try {
        const email = req.body;
        const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "365d",
        });
        res
          .cookie("token", token, CookieOptions)
          .status(200)
          .send({ success: true, message: "Token generation success" });
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Token generation failed" });
      }
    });

    // Clear token on logout
    app.get("/logout", (req, res) => {
      try {
        res.clearCookie("token", { ...CookieOptions, maxAge: 0 });
        console.log("Token cleared from cookies");
        res.status(200).send({ success: true });
        console.log("Logout successful");
      } catch (error) {
        console.error("Logout error:", error);
        res.status(500).send({ success: false, error: "Logout failed" });
      }
    });

    // register as employee
    app.post("/register-employee", async (req, res) => {
      try {
        // Extract data from request body
        const { fullName, email, password, dateOfBirth } = req.body;

        // Check if email is already registered
        const existingEmployee = await userCollection.findOne({ email });
        if (existingEmployee) {
          return res.status(400).json({ error: "Email already exists" });
        }

        // Insert new employee into the database
        await userCollection.insertOne({
          fullName,
          email,
          password, // Remember to hash the password before saving it in production
          dateOfBirth,
          image: null,
          companyName: null, // Initially set to null
          companyLogo: null, // Initially set to null
          role: "employee", // Set the role to employee
          team: [], // Empty array for team, will be updated by HR manager
        });

        // Respond with success message
        res.status(201).json({ message: "Employee registered successfully" });
      } catch (error) {
        console.error("Error registering employee:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    //register hr
    app.post("/register-hr-manager", async (req, res) => {
      try {
        // Extract data from request body
        const {
          fullName,
          companyName,
          companyLogo,
          email,
          password,
          dateOfBirth,
          selectedPackage,
        } = req.body;
    
        // Check if email is already registered
        const existingHRManager = await userCollection.findOne({ email });
        if (existingHRManager) {
          return res.status(400).json({ error: "Email already exists" });
        }
    
        // Insert new HR manager into the database
        const result = await userCollection.insertOne({
          fullName,
          companyName,
          companyLogo,
          email,
          password, // Remember to hash the password before saving it in production
          dateOfBirth,
          role: "hr", // Set the role to HR manager
          package: null,
          limit: 0,
          team: [], // Empty array for team, will be updated by HR manager
        });
        res.status(201).json({ message: "HR manager registered successfully" });
      } catch (error) {
        console.error("Error registering HR manager:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // check user role
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;  // Extract email from request parameters
      try {
        const query = { email: email };
        const user = await userCollection.findOne(query);
        let role;
        if (user) {
          role = user.role;
        }
        res.send({ role });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    });

    // update hr's limit
    app.post('/update-payment', async (req, res) => {
      try {
        const { email, package, limit } = req.body;
    
        // Validate the input data
        if (!email || !package || !limit) {
          return res.status(400).json({ error: "Invalid input data" });
        }
    
        // Find the existing user by email
        const existingUser = await userCollection.findOne({ email });
    
        // Determine the new limit value
        const currentLimit = existingUser && existingUser.limit ? existingUser.limit : 0;
        const newLimit = currentLimit + parseInt(limit);
    
        // Update the user's payment and limit fields in the database
        const result = await userCollection.updateOne(
          { email },
          { $set: { package, limit: newLimit } }
        );
    
        if (result.modifiedCount > 0) {
          res.status(200).json({ paymentResult: 'success' });
        } else {
          res.status(400).json({ error: "Failed to update payment details" });
        }
      } catch (error) {
        console.error("Error updating payment details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    
    
    


  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
