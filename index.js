const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://assetmart-8e93a.web.app",
    "https://assetmart-8e93a.firebaseapp.com",
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
    const assetRequestsCollection = client
      .db("assetMartDB")
      .collection("assetRequests");

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
          companyName: "", // Initially set to null
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
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email; // Extract email from request parameters
      try {
        const query = { email: email };
        const user = await userCollection.findOne(query);
        let role, companyName, companyLogo;
        if (user) {
          role = user.role;
          companyName = user.companyName;
          companyLogo = user.companyLogo;
        }
        res.send({ role, companyName, companyLogo });
      } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });
    
    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // update hr's limit
    app.post("/update-payment", async (req, res) => {
      try {
        const { email, package, limit } = req.body;

        // Validate the input data
        if (!email || !package || !limit) {
          return res.status(400).json({ error: "Invalid input data" });
        }

        // Find the existing user by email
        const existingUser = await userCollection.findOne({ email });

        // Determine the new limit value
        const currentLimit =
          existingUser && existingUser.limit ? existingUser.limit : 0;
        const newLimit = currentLimit + parseInt(limit);

        // Update the user's payment and limit fields in the database
        const result = await userCollection.updateOne(
          { email },
          { $set: { package, limit: newLimit } }
        );

        if (result.modifiedCount > 0) {
          res.status(200).json({ paymentResult: "success" });
        } else {
          res.status(400).json({ error: "Failed to update payment details" });
        }
      } catch (error) {
        console.error("Error updating payment details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // get all asset
    app.get("/assets", async (req, res) => {
      try {
        const assets = await assetsCollection.find().toArray();
        res.status(200).json(assets);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch assets" });
      }
    });

    // add an asset
    app.post("/assets", async (req, res) => {
      try {
        const { productName, productType, productQuantity } = req.body;

        // Create a new asset object
        const newAsset = {
          assetName: productName,
          assetType: productType,
          quantity: parseInt(productQuantity), // Convert quantity to integer
          dateAdded: new Date(), // Add current date as the date added
        };

        // Insert the new asset into the database
        const result = await assetsCollection.insertOne(newAsset);

        if (result.insertedId) {
          res.status(201).json({
            message: "Asset added successfully",
            assetId: result.insertedId,
          });
        } else {
          res.status(500).json({ error: "Failed to add asset" });
        }
      } catch (error) {
        console.error("Error adding asset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // get a specific asset
    app.get("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const asset = await assetsCollection.findOne(query);
        if (asset) {
          res.json(asset);
        } else {
          res.status(404).json({ message: "Asset not found" });
        }
      } catch (error) {
        console.error("Error fetching asset:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Update asset
    app.patch("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      console.log()
      try {
        const result = await assetsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.modifiedCount > 0) {
          res.json({ modifiedCount: result.modifiedCount });
        } else {
          res.status(404).json({ message: "Asset not found" });
        }
      } catch (error) {
        console.error("Error updating asset:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // delete asset
    app.delete("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const deletedAsset = await assetsCollection.deleteOne(query);

        if (deletedAsset) {
          res.status(200).json({ message: "Asset deleted successfully" });
        } else {
          res.status(404).json({ message: "Asset not found" });
        }
      } catch (error) {
        console.error("Error deleting asset:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // asset request from employee
    app.post("/request-asset", async (req, res) => {
      try {
        const { assetId, userEmail, notes } = req.body;
        // Find the user to get the logged-in user's information
        const userFromDB = await userCollection.findOne({ email: userEmail });
        const asset = await assetsCollection.findOne({
          _id: new ObjectId(assetId),
        });

        // Create a new asset request
        const newRequest = {
          assetId: new ObjectId(assetId),
          userId: new ObjectId(userFromDB._id),
          assetName: asset.assetName,
          assetType: asset.assetType,
          requestDate: new Date(),
          approvalDate: null,
          requestStatus: "pending",
          notes: notes,
          companyName: userFromDB.companyName, // Store the logged-in user's company information
        };
        const result = await assetRequestsCollection.insertOne(newRequest);

        res.status(201).json({
          message: "Asset requested successfully",
          requestId: result.insertedId,
        });
      } catch (error) {
        console.error("Error requesting asset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Page: My Requested Assets (For Employee)
    // part 1: fetch assets
    app.get("/requested-assets/:userEmail", async (req, res) => {
      try {
        const userEmail = req.params.userEmail;
        const userFromDB = await userCollection.findOne({ email: userEmail });
        let query = { userId: new ObjectId(userFromDB._id) };

        const assets = await assetRequestsCollection.find(query).toArray();
        res.status(200).json(assets);
      } catch (error) {
        console.error("Error fetching requested assets:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // part 2: Cancel Request API
    app.post("/cancel-request", async (req, res) => {
      try {
        const { requestId } = req.body;
        const result = await assetRequestsCollection.updateOne(
          { _id: new ObjectId(requestId), requestStatus: "pending" },
          { $set: { requestStatus: "canceled", approvalDate: null } }
        );
        if (result.modifiedCount === 0) {
          return res
            .status(400)
            .json({ error: "Request not found or already processed" });
        }

        res.status(200).json({ message: "Request canceled successfully" });
      } catch (error) {
        console.error("Error canceling request:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // part 3: Return Asset API
    app.post("/return-asset", async (req, res) => {
      try {
        const { requestId } = req.body;

        // Find the request to get the asset details
        const request = await assetRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });

        // Update the request status to "returned" and increase the asset quantity by one
        const updateRequest = assetRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { requestStatus: "returned" } }
        );

        const asset = await assetsCollection.findOne({
          _id: new ObjectId(request.assetId),
        });

        const newQuantity = parseInt(asset.quantity) + 1;

        const updateAsset = assetsCollection.updateOne(
          { _id: new ObjectId(request.assetId) },
          { $set: { quantity: newQuantity.toString() } }
        );

        await Promise.all([updateRequest, asset, updateAsset]);

        res.status(200).json({ message: "Asset returned successfully" });
      } catch (error) {
        console.error("Error returning asset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // team member list
    app.post("/employee-list", async (req, res) => {
      const email = req.body.email;
      try {
        const user = await userCollection.findOne({ email });
        const companyName = user.companyName;
        const employees = await userCollection.find({ companyName }).toArray();
        res.status(200).json(employees);
      } catch (error) {
        console.error("Error fetching employee list:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // remove a team member from
    app.put("/remove-from-team/:employeeId", async (req, res) => {
      try {
        const { employeeId } = req.params;
        console.log(employeeId);
        const hrManagerEmail = req.body.hrManagerEmail;

        const hrManager = await userCollection.findOne({
          email: hrManagerEmail,
        });
        // Update the employee's companyName to null to remove them from the team
        const result = await userCollection.updateOne(
          { _id: new ObjectId(employeeId) },
          { $set: { companyName: "", companyLogo: null } }
        );

        if (result.modifiedCount > 0) {
          // Increment the HR Manager's limit by 1
          await userCollection.updateOne(
            { _id: new ObjectId(hrManager._id) },
            { $inc: { limit: 1 } }
          );

          res
            .status(200)
            .json({ message: "Employee removed from the team successfully" });
        } else {
          res.status(404).json({
            error: "Employee not found or already removed from the team",
          });
        }
      } catch (error) {
        console.error("Error removing employee from the team:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Page: Add an Employee Page (Only for HR Manager)
    // part 1: Fetch unaffiliated employees
    app.get("/unaffiliated-employees", async (req, res) => {
      try {
        const unaffiliatedEmployees = await userCollection
          .find({ $or: [{ companyName: null }, { companyName: "" }] })
          .toArray();
        res.status(200).json(unaffiliatedEmployees);
      } catch (error) {
        console.error("Error fetching unaffiliated employees:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // add multiple people to the team
    app.put("/add-to-team", async (req, res) => {
      const { employeeIds, hrManagerEmail } = req.body;

      try {
        // Fetch HR manager's details including the company name and limit
        const hrManager = await userCollection.findOne({
          email: hrManagerEmail,
        });

        const companyName = hrManager.companyName;
        const companyLogo = hrManager.companyLogo;
        const currentLimit = hrManager.limit;
        const numberOfEmployeesToAdd = employeeIds.length;

        // Check if the HR manager is within their limit
        if (numberOfEmployeesToAdd > currentLimit) {
          return res.status(400).json({
            error: "You can't add these members, please upgrade your account",
          });
        }

        // Update the employees with the company name
        const updateResult = await userCollection.updateMany(
          { _id: { $in: employeeIds.map((id) => new ObjectId(id)) } },
          { $set: { companyName, companyLogo } }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(404).json({ error: "No employees were updated" });
        }

        // Deduct the number of people added from the HR manager's limit
        const newLimit = currentLimit - numberOfEmployeesToAdd;
        await userCollection.updateOne(
          { email: hrManagerEmail },
          { $set: { limit: newLimit } }
        );

        res
          .status(200)
          .json({ message: "Employees successfully added to the team" });
      } catch (error) {
        console.error("Error adding employees to the team:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Fetch HR limit based on user email
    app.post("/hr-limit", async (req, res) => {
      const { email } = req.body;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ error: "HR Manager not found" });
        }
        const limit = user.limit;
        res.status(200).json({ limit });
      } catch (error) {
        console.error("Error fetching HR limit:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // All Requests Page (Only for HR Manager)
    // part 1: Get All Requests with Search
    app.get("/requests/:email", async (req, res) => {
      try {
        const userEmail = req.params.email;
    
        // Find HR's information to get companyName
        const user = await userCollection.findOne({ email: userEmail });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
    
        const companyName = user.companyName;
    
        // Fetch requests matching the companyName and include requester and asset details
        const requests = await assetRequestsCollection.find({ companyName }).toArray();
    
        const detailedRequests = await Promise.all(requests.map(async (request) => {
          const userDetail = await userCollection.findOne({ _id: new ObjectId(request.userId) });
          const assetDetail = await assetsCollection.findOne({ _id: new ObjectId(request.assetId) });
    
          return {
            ...request,
            requesterName: userDetail ? userDetail.fullName : "Unknown User",
            requesterEmail: userDetail ? userDetail.email : "Unknown Email",
            assetName: assetDetail ? assetDetail.assetName : "Unknown Asset",
            assetType: assetDetail ? assetDetail.assetType : "Unknown Type",
          };
        }));
    
        res.status(200).json(detailedRequests);
      } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // part 2: approve request
    app.post("/approve-request", async (req, res) => {
      const { requestId } = req.body;
      try {
        
        // Find the request to get the asset details
        const request = await assetRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });

        // Update the request status to "returned" and decrease the asset quantity by one
        const updateRequest = assetRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { requestStatus: "approved", approvalDate: new Date() } }
        );

        const asset = await assetsCollection.findOne({
          _id: new ObjectId(request.assetId),
        });

        const newQuantity = parseInt(asset.quantity) - 1;

        const updateAsset = assetsCollection.updateOne(
          { _id: new ObjectId(request.assetId) },
          { $set: { quantity: newQuantity.toString() } }
        );

        await Promise.all([updateRequest, asset, updateAsset]);

        res.status(200).json({ message: "Asset approved successfully" });

      } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // part 3: reject request
    app.post("/reject-request", async (req, res) => {
      const { requestId } = req.body;
      try {
        const result = await assetRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { requestStatus: "rejected", approvalDate: new Date() } }
        );
        if (result.modifiedCount > 0) {
          res.status(200).json({ message: "Request rejected successfully" });
        } else {
          res.status(404).json({ error: "Request not found" });
        }
      } catch (error) {
        console.error("Error rejecting request:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // update profile

    app.put('/updateProfile/:email', async (req, res) => {
      const { fullName, photoURL, phoneNumber } = req.body;
      const email = req.params.email;
      console.log(email);
    
      try {
        const user = await userCollection.findOne({ email: email });
        console.log(user);
    
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }
    
        // Check if the new values are different from the current values
        const isFullNameChanged = fullName && fullName !== user.fullName;
        const isPhotoURLChanged = photoURL && photoURL !== user.photoURL;
        const isPhoneNumberChanged = phoneNumber && phoneNumber !== user.phoneNumber;
    
        // If no changes, return success without updating
        if (!isFullNameChanged && !isPhotoURLChanged && !isPhoneNumberChanged) {
          return res.status(200).json({ message: 'No changes detected, profile is already up to date', user });
        }
    
        const updateFields = {};
        if (isFullNameChanged) updateFields.fullName = fullName;
        if (isPhotoURLChanged) updateFields.photoURL = photoURL;
        if (isPhoneNumberChanged) updateFields.phoneNumber = phoneNumber;
    
        const updateResult = await userCollection.updateOne(
          { email: email },
          { $set: updateFields }
        );
        console.log(updateResult);
    
        res.status(200).json({
          message: 'Profile updated successfully',
          user: { ...user, ...updateFields }
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
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
