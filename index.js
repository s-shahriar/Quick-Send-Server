const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();

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
        return res.status(401).send({ message: "Token authentication error", error: err.message });
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
    const userCollection = client.db("libraryDB").collection("users");
    const bookCollection = client.db("libraryDB").collection("book");

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

    app.get("/userExists/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollection.findOne({ email });
        res.json({ exists: !!user });
      } catch (error) {
        console.error("Error checking user existence:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/userAdd", async (req, res) => {
      try {
        const newUser = req.body;
        const result = await userCollection.insertOne(newUser);
        console.log(result);
        res.status(201).json({ message: "User added successfully" });
      } catch (error) {
        console.error("Error adding user:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/all-book-home", async (req, res) => {
      let limitValue = 9; // Default limit value
      const { limit } = req.query;

      // Check if query parameter 'limit' exists and its value is 'all'
      if (limit && limit.toLowerCase() === "all") {
        limitValue = null; // Set limitValue to null to return all data
      }

      // Create query to find books with optional limit
      const query = bookCollection.find().sort({ _id: -1 });
      if (limitValue !== null) {
        query.limit(limitValue);
      }

      // Execute the query
      const result = await query.toArray();

      // Send the result
      res.send(result);
    });

    app.get("/categories", async (req, res) => {
      try {
        // Step 1: Retrieve Categories
        const categories = await bookCollection
          .aggregate([{ $group: { _id: "$category" } }])
          .toArray();

        // Extract category names from the result
        const categoryNames = categories.map((category) => category._id);

        // Respond with the categories
        res.json(categoryNames);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.get("/books-by-category/:category", async (req, res) => {
      const { category } = req.params;
      try {
        const books = await bookCollection
          .find({ category: category })
          .toArray();
        res.send(books);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.patch("/return-book/:bookId", async (req, res) => {
      try {
        const { bookId } = req.params;
        const { email } = req.body;

        // Update book's borrowedBy array
        const book = await bookCollection.updateOne(
          { _id: new ObjectId(bookId) },
          {
            $pull: { borrowedBy: { email } },
            $inc: { quantity: 1 },
          }
        );

        // Update user's borrowedBooks array
        const user = await userCollection.updateOne(
          { email },
          { $pull: { borrowedBooks: bookId } }
        );

        res.status(200).send("Book returned successfully");
      } catch (error) {
        console.error("Error returning book:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/check-user-role", async (req, res) => {
      const user = await userCollection.findOne({ email: req.query.email });
      if (!user || user.role !== "admin") {
        res.send("normal");
      } else {
        res.send("admin");
      }
    });

    // token removed START

    app.get("/all-book", async (req, res) => {
      let limitValue = 9; // Default limit value
      const { limit } = req.query;

      // Check if query parameter 'limit' exists and its value is 'all'
      if (limit && limit.toLowerCase() === "all") {
        limitValue = null; // Set limitValue to null to return all data
      }

      // Create query to find books with optional limit
      const query = bookCollection.find().sort({ _id: -1 });
      if (limitValue !== null) {
        query.limit(limitValue);
      }

      // Execute the query
      const result = await query.toArray();

      // Send the result
      res.send(result);
    });

    app.get("/book-details/:bookId", async (req, res) => {
      try {
        const { bookId } = req.params;
        const query = { _id: new ObjectId(bookId) };
        // Query the database for the details of the selected book
        const book = await bookCollection.findOne(query);
        // Respond with the book details
        res.json(book);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/borrow-book/:bookId", async (req, res) => {
      try {
        const { bookId } = req.params;
        const { email, displayName, returnDate } = req.body;
        // Query the database for the book
        const query = { _id: new ObjectId(bookId) };
        const book = await bookCollection.findOne(query);

        // Query the database for the user
        const user = await userCollection.findOne({ email: email });
        // Check if the user has already borrowed the book
        const alreadyBorrowed = book.borrowedBy.some(
          (borrower) => borrower.email === email
        );

        if (alreadyBorrowed) {
          return res.send({ message: "You have already borrowed this book" });
        }

        // Check if the user has reached the maximum borrowing limit
        if (user.borrowedBooks.length >= 3) {
          return res.send({
            message: "You have reached the maximum borrowing limit",
          });
        }

        // Update book details to mark it as borrowed
        const updatedBook = await bookCollection.findOneAndUpdate(
          query,
          {
            $push: {
              borrowedBy: {
                email,
                name: displayName,
                borrowDate: new Date().toLocaleDateString(),
                returnDate: returnDate,
              },
            },
            $inc: { quantity: -1 },
          },
          { new: true }
        );

        // Update user's borrowing history
        await userCollection.findOneAndUpdate(
          { email: email },
          { $push: { borrowedBooks: bookId } }
        );

        // Respond with the updated book details
        res.json(updatedBook);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    app.post("/add-book", async (req, res) => {
      try {
        const user = await userCollection.findOne({ email: req.query.email });

        if (!user || user.role !== "admin") {
          return res.send(user.role);
        }

        // Extract book details from request body
        const { image, name, quantity, author, category, description, rating } =
          req.body;
        const bookQuantity = parseInt(quantity);
        const bookRating = parseInt(rating);

        // Create a new book object
        const newBook = {
          image,
          name,
          quantity: bookQuantity,
          author,
          category,
          description,
          rating: bookRating,
          // Initialize `borrowedBy` as an array of objects with null values
          borrowedBy: [
            {
              email: null,
              name: null,
              borrowDate: null,
              returnDate: null,
            },
          ],
        };

        // Insert the new book into the database
        const result = await bookCollection.insertOne(newBook);
        // Respond with the result
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // app.patch("/update-book/:id", async (req, res) => {
    //   try {
    //     const user = await userCollection.findOne({ email: req.query.email });

    //     if (!user || user.role !== "admin") {
    //       return res.send(user.role);
    //   }

    //     const { id } = req.params;
    //     const updatedBook = req.body;
    //     const { _id, ...updatedFields } = updatedBook;
    //     const query = { _id: new ObjectId(id) };
    //     const update = {
    //       $set: updatedFields,
    //     };
    //     // Find the book by its ID and update it
    //     const book = await bookCollection.updateOne(query, update);
    //     res.send(book); // Return the updated book
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ error: "Internal server error" });
    //   }
    // });

    app.get("/borrowed-books/:email", async (req, res) => {
      try {
        const { email } = req.params;
        // Query the database for the user's borrowed books
        const user = await userCollection.findOne({ email: email });
        if (!user) {
          return res.send({ message: "user not found" });
        }
        const borrowedBookIds = user.borrowedBooks;

        // Fetch details of each borrowed book
        const borrowedBooks = [];
        for (const bookId of borrowedBookIds) {
          const query = { _id: new ObjectId(bookId) };
          const book = await bookCollection.findOne(query);
          if (book) {
            borrowedBooks.push(book);
          }
        }
        // Respond with the borrowed books
        res.json(borrowedBooks);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // token removed END

    // with token START

    // app.get("/all-book", verifyToken, async (req, res) => {
    //   if (req.user.email !== req.query.email) {
    //     console.log("ALL section -- email not verified");
    //     return res.status(403).send({ message: "forbidden access" });
    //   }

    //   console.log("ALL section -- email verified");

    //   let limitValue = 9; // Default limit value
    //   const { limit } = req.query;

    //   // Check if query parameter 'limit' exists and its value is 'all'
    //   if (limit && limit.toLowerCase() === "all") {
    //     limitValue = null; // Set limitValue to null to return all data
    //   }

    //   // Create query to find books with optional limit
    //   const query = bookCollection.find().sort({ _id: -1 });
    //   if (limitValue !== null) {
    //     query.limit(limitValue);
    //   }

    //   // Execute the query
    //   const result = await query.toArray();

    //   // Send the result
    //   res.send(result);
    // });

    // app.get("/book-details/:bookId", verifyToken, async (req, res) => {
    //   try {
    //     if (req.user.email !== req.query.email) {
    //       console.log("book section -- email not verified");
    //       return res.status(403).send({ message: "forbidden access" });
    //     }

    //     console.log("book section -- email verified");

    //     const { bookId } = req.params;
    //     const query = { _id: new ObjectId(bookId) };
    //     // Query the database for the details of the selected book
    //     const book = await bookCollection.findOne(query);
    //     // Respond with the book details
    //     res.json(book);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Internal server error" });
    //   }
    // });

    // app.post("/borrow-book/:bookId", verifyToken, async (req, res) => {
    //   try {
    //     if (req.user.email !== req.query.email) {
    //       console.log("BORROW section -- email not verified");
    //       return res.status(403).send({ message: "forbidden access" });
    //     }

    //     console.log("BORROW section -- email verified");

    //     const { bookId } = req.params;
    //     const { email, displayName, returnDate } = req.body;
    //     // Query the database for the book
    //     const query = { _id: new ObjectId(bookId) };
    //     const book = await bookCollection.findOne(query);

    //     // Query the database for the user
    //     const user = await userCollection.findOne({ email: email });
    //     // Check if the user has already borrowed the book
    //     const alreadyBorrowed = book.borrowedBy.some(
    //       (borrower) => borrower.email === email
    //     );

    //     if (alreadyBorrowed) {
    //       return res.send({ message: "You have already borrowed this book" });
    //     }

    //     // Check if the user has reached the maximum borrowing limit
    //     if (user.borrowedBooks.length >= 3) {
    //       return res.send({
    //         message: "You have reached the maximum borrowing limit",
    //       });
    //     }

    //     // Update book details to mark it as borrowed
    //     const updatedBook = await bookCollection.findOneAndUpdate(
    //       query,
    //       {
    //         $push: {
    //           borrowedBy: {
    //             email,
    //             name: displayName,
    //             borrowDate: new Date().toLocaleDateString(),
    //             returnDate: returnDate,
    //           },
    //         },
    //         $inc: { quantity: -1 },
    //       },
    //       { new: true }
    //     );

    //     // Update user's borrowing history
    //     await userCollection.findOneAndUpdate(
    //       { email: email },
    //       { $push: { borrowedBooks: bookId } }
    //     );

    //     // Respond with the updated book details
    //     res.json(updatedBook);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Internal server error" });
    //   }
    // });

    // app.post("/add-book", verifyToken, async (req, res) => {
    //   try {
    //     if (req.user.email !== req.query.email) {
    //       console.log("ADD BOOK section -- email not verified");
    //       return res.status(403).send({ message: "forbidden access" });
    //     }

    //     const user = await userCollection.findOne({ email: req.query.email });

    //     if (!user || user.role !== "admin") {
    //         return res.send(user.role);
    //     }

    //     // Extract book details from request body
    //     const { image, name, quantity, author, category, description, rating } =
    //       req.body;
    //     const bookQuantity = parseInt(quantity);
    //     const bookRating = parseInt(rating);

    //     // Create a new book object
    //     const newBook = {
    //       image,
    //       name,
    //       quantity: bookQuantity,
    //       author,
    //       category,
    //       description,
    //       rating: bookRating,
    //       // Initialize `borrowedBy` as an array of objects with null values
    //       borrowedBy: [
    //         {
    //           email: null,
    //           name: null,
    //           borrowDate: null,
    //           returnDate: null,
    //         },
    //       ],
    //     };

    //     // Insert the new book into the database
    //     const result = await bookCollection.insertOne(newBook);
    //     // Respond with the result
    //     res.json(result);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Internal server error" });
    //   }
    // });

    app.patch("/update-book/:id", verifyToken, async (req, res) => {
      console.log("from token: ",req.user.email)
      console.log("from query: ", req.query.email)
      try {
        if (req.user.email !== req.query.email) {
          console.log("UPDATE section -- email not verified");
          return res.status(403).send({ message: "forbidden access" });
        }
        console.log("UPDATE section -- email verified");
        return res.status(200).send({message:"Token verified"})

        const user = await userCollection.findOne({ email: req.query.email });

        if (!user || user.role !== "admin") {
          return res.send(user.role);
        }

        const { id } = req.params;
        const updatedBook = req.body;
        const { _id, ...updatedFields } = updatedBook;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: updatedFields,
        };
        // Find the book by its ID and update it
        const book = await bookCollection.updateOne(query, update);
        res.send(book); // Return the updated book
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // app.get("/borrowed-books/:email", verifyToken, async (req, res) => {
    //   try {
    //     const { email } = req.params;

    //     if (req.user.email !== email) {
    //       console.log("UPDATE section -- email not verified");
    //       return res.status(403).send({ message: "forbidden access" });
    //     }

    //     console.log("BORROW section -- email verified");

    //     // Query the database for the user's borrowed books
    //     const user = await userCollection.findOne({ email: email });
    //     if (!user) {
    //       return res.send({ message: "user not found" });
    //     }
    //     const borrowedBookIds = user.borrowedBooks;

    //     // Fetch details of each borrowed book
    //     const borrowedBooks = [];
    //     for (const bookId of borrowedBookIds) {
    //       const query = { _id: new ObjectId(bookId) };
    //       const book = await bookCollection.findOne(query);
    //       if (book) {
    //         borrowedBooks.push(book);
    //       }
    //     }
    //     // Respond with the borrowed books
    //     res.json(borrowedBooks);
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).json({ message: "Internal server error" });
    //   }
    // });

    // with token END

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
