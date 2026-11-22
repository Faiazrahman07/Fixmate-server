
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";
import { jwtVerify, createRemoteJWKSet } from "jose";

const app = express();
const PORT = process.env.PORT || 5000;

const AUTH_URL = process.env.AUTH_URL || "http://localhost:3000";

const { DB_USER, DB_PASSWORD } = process.env;

if (!DB_USER || !DB_PASSWORD) {
  console.error(
    "MongoDB configuration error: DB_USER and DB_PASSWORD must be set."
  );
  process.exit(1);
}

const client = new MongoClient(
  `mongodb+srv://${DB_USER}:${DB_PASSWORD}@cluster0.ofxhydd.mongodb.net/`,
  {
    serverSelectionTimeoutMS: 10000,
  }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(cors());

async function connectToMongoDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
    return client;
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
    throw error;
  }
}

let database;

try {
  const connectedClient = await connectToMongoDB();
  database = connectedClient.db("Fixmate");
} catch (error) {
  console.error(
    "Failed to connect to MongoDB. The server will not start."
  );
  process.exit(1);
}

const user = database.collection("user");
const services = database.collection("services");
const bookings = database.collection("bookings");
const payments = database.collection("payments");

await payments.createIndex(
  { bookingId: 1 },
  { unique: true }
);
const JWKS = createRemoteJWKSet(
  new URL(`${AUTH_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Unauthorized access",
      });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });

    if (!payload.sub || !payload.email) {
      return res.status(401).send({
        message: "Invalid token payload",
      });
    }

    
    const currentUser = await user.findOne({
      email: payload.email,
    });

    if (!currentUser) {
      return res.status(401).send({
        message: "User not found",
      });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: currentUser.role || "customer",
    };

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);

    return res.status(401).send({
      message: "Invalid or expired token",
    });
  }
};

const verifyCustomer = (req, res, next) => {
  if (req.user.role !== "customer") {
    return res.status(403).send({
      message: "Customer access only",
    });
  }

  next();
};

const verifyTechnician = (req, res, next) => {
  if (req.user.role !== "technician") {
    return res.status(403).send({
      message: "Technician access only",
    });
  }

  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({
      message: "Admin access only",
    });
  }

  next();
};

app.get("/", (req, res) => {
  res.send("FixMate Server is Running!");
});


app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await user.find({}).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch users",
    });
  }
});


app.patch("/api/users/profile", verifyToken, async (req, res) => {
  try {
    const { name, image } = req.body;

    const result = await user.updateOne(
      { email: req.user.email },
      {
        $set: {
          name,
          image,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    res.send({
      message: "Profile updated successfully",
      result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update profile",
    });
  }
});


app.get("/api/services", async (req, res) => {
  try {
    const { search, category, serviceMode, sort } = req.query;

    if (typeof search === "string" && search.length > 100) {
      return res.status(400).send({
        message: "Search query must be 100 characters or fewer",
      });
    }

    const query = {
      status: "approved",
    };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    if (category && category !== "all") {
      query.category = category;
    }

    if (serviceMode && serviceMode !== "all") {
      query.serviceMode = serviceMode;
    }

    const sortOption =
      sort === "price-low"
        ? { basePrice: 1 }
        : sort === "price-high"
          ? { basePrice: -1 }
          : { createdAt: -1 };

    const result = await services
      .find(query)
      .sort(sortOption)
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Services Fetch Error:", error);

    res.status(500).send({
      message: "Failed to fetch services",
    });
  }
});


app.get("/api/services/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid service ID",
      });
    }

    const result = await services.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Service not found",
      });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch service",
    });
  }
});


app.post(
  "/api/services",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      const service = {
        ...req.body,
        technicianEmail: req.user.email,
        status: "pending",
      };

      const result = await services.insertOne(service);

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to create service",
      });
    }
  }
);


app.patch(
  "/api/services/:id",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid service ID",
        });
      }

      const updatedData = { ...req.body };

  
      delete updatedData.technicianEmail;
      delete updatedData.status;
      delete updatedData._id;

      const result = await services.updateOne(
        {
          _id: new ObjectId(id),
          technicianEmail: req.user.email,
        },
        {
          $set: updatedData,
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          message: "Service not found",
        });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to update service",
      });
    }
  }
);

app.delete(
  "/api/services/:id",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid service ID",
        });
      }

      const result = await services.deleteOne({
        _id: new ObjectId(id),
        technicianEmail: req.user.email,
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({
          message: "Service not found",
        });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to delete service",
      });
    }
  }
);


app.get(
  "/api/my-services/:email",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      if (req.params.email !== req.user.email) {
        return res.status(403).send({
          message: "Access forbidden",
        });
      }

      const result = await services.find({
        technicianEmail: req.user.email,
      }).toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch services",
      });
    }
  }
);


app.post(
  "/api/bookings",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { serviceId } = req.body;

      if (!ObjectId.isValid(serviceId)) {
        return res.status(400).send({
          message: "Invalid service ID",
        });
      }

      const service = await services.findOne({
        _id: new ObjectId(serviceId),
        status: "approved",
      });

      if (!service) {
        return res.status(404).send({
          message: "Approved service not found",
        });
      }

      const existingBooking = await bookings.findOne({
        serviceId,
        customerEmail: req.user.email,
        status: {
          $in: ["requested", "accepted", "in-progress"],
        },
      });

      if (existingBooking) {
        return res.status(400).send({
          message: "You have already booked this service",
        });
      }

      const booking = {
        ...req.body,
        customerEmail: req.user.email,
        technicianEmail: service.technicianEmail,
        serviceTitle:
          service.serviceTitle ||
          service.title ||
          service.name,
        status: "requested",
        paymentStatus: "unpaid",
        createdAt: new Date(),
      };

      const result = await bookings.insertOne(booking);

      res.send(result);
    } catch (error) {
      console.error(error);

      res.status(500).send({
        message: "Failed to create booking",
      });
    }
  }
);

app.get(
  "/api/bookings/check/:serviceId/:email",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { serviceId, email } = req.params;

      if (email !== req.user.email) {
        return res.status(403).send({
          message: "Access forbidden",
        });
      }

      const result = await bookings.findOne({
        serviceId,
        customerEmail: req.user.email,
        status: {
          $in: ["requested", "accepted", "in-progress"],
        },
      });

      res.send({
        alreadyBooked: !!result,
      });
    } catch (error) {
      res.status(500).send({
        message: "Failed to check booking",
      });
    }
  }
);

app.get(
  "/api/bookings/my",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const result = await bookings.find({
        customerEmail: req.user.email,
      }).toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch bookings",
      });
    }
  }
);


app.patch(
  "/api/bookings/:id/cancel",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid booking ID",
        });
      }

      const result = await bookings.updateOne(
        {
          _id: new ObjectId(id),
          customerEmail: req.user.email,
          status: "requested",
        },
        {
          $set: {
            status: "cancelled",
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          message: "Booking not found or cannot be cancelled",
        });
      }

      res.send({
        message: "Booking cancelled successfully",
        result,
      });
    } catch (error) {
      res.status(500).send({
        message: "Failed to cancel booking",
      });
    }
  }
);


app.get(
  "/api/bookings/technician/:email",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      if (req.params.email !== req.user.email) {
        return res.status(403).send({
          message: "Access forbidden",
        });
      }

      const result = await bookings.find({
        technicianEmail: req.user.email,
      }).toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch technician bookings",
      });
    }
  }
);


app.patch(
  "/api/bookings/:id/status",
  verifyToken,
  verifyTechnician,
  async (req, res) => {
    try {
      const id = req.params.id;
      const { status, finalAmount } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid booking ID",
        });
      }

      const booking = await bookings.findOne({
        _id: new ObjectId(id),
        technicianEmail: req.user.email,
      });

      if (!booking) {
        return res.status(404).send({
          message: "Booking not found",
        });
      }

      const allowedTransitions = {
        requested: ["accepted", "rejected"],
        accepted: ["in-progress"],
        "in-progress": ["completed"],
        completed: [],
        rejected: [],
        cancelled: [],
      };

      const allowedNextStatus = allowedTransitions[booking.status];

      if (!allowedNextStatus?.includes(status)) {
        return res.status(400).send({
          message: `Cannot change status from ${booking.status} to ${status}`,
        });
      }

      const updateData = {
        status,
      };

      if (status === "completed") {
        if (
          typeof finalAmount !== "number" ||
          !Number.isFinite(finalAmount) ||
          finalAmount <= 0
        ) {
          return res.status(400).send({
            message: "A valid final amount is required",
          });
        }

        updateData.finalAmount = finalAmount;
      }

      const result = await bookings.updateOne(
        {
          _id: new ObjectId(id),
          technicianEmail: req.user.email,
          status: booking.status,
        },
        {
          $set: updateData,
        }
      );

      if (result.matchedCount === 0) {
  return res.status(409).send({
    message: "Booking status has already changed. Please refresh.",
  });
}

res.send({
  message: "Booking status updated successfully",
  result,
});
    } catch (error) {
      console.error(error);

      res.status(500).send({
        message: "Failed to update booking status",
      });
    }
  }
);




app.get(
  "/api/admin/users",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await user.find({}).toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch users",
      });
    }
  }
);

app.get(
  "/api/admin/services",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await services.find({})
        .sort({ _id: -1 })
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Admin Services Error:", error);

      res.status(500).send({
        message: "Failed to fetch admin services",
      });
    }
  }
);


app.patch(
  "/api/admin/users/:id/role",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;
      const { role } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid user ID",
        });
      }

      const allowedRoles = ["customer", "technician", "admin"];

      if (!allowedRoles.includes(role)) {
        return res.status(400).send({
          message: "Invalid role",
        });
      }

      const result = await user.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            role,
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          message: "User not found",
        });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to update user role",
      });
    }
  }
);


app.patch(
  "/api/admin/services/:id/approval",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const id = req.params.id;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          message: "Invalid service ID",
        });
      }

      if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).send({
          message: "Invalid service status",
        });
      }

      const result = await services.updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            status,
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          message: "Service not found",
        });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to update service approval",
      });
    }
  }
);

app.get(
  "/api/admin/bookings",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await bookings.find({})
        .sort({ _id: -1 })
        .toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch bookings",
      });
    }
  }
);


app.get(
  "/api/admin/payments",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await payments.find({})
        .sort({ _id: -1 })
        .toArray();

      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch payments",
      });
    }
  }
);
app.get(
  "/api/payments/my",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const result = await payments
        .find({ customerEmail: req.user.email })
        .sort({ _id: -1 })
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Customer Payments Error:", error);

      res.status(500).send({
        message: "Failed to fetch payment history",
      });
    }
  }
);

app.post(
  "/api/payments/create-checkout-session",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { bookingId } = req.body;

      if (!ObjectId.isValid(bookingId)) {
        return res.status(400).send({
          message: "Invalid booking ID",
        });
      }

      const booking = await bookings.findOne({
        _id: new ObjectId(bookingId),
        customerEmail: req.user.email,
      });

      if (!booking) {
        return res.status(404).send({
          message: "Booking not found",
        });
      }

      if (booking.status !== "completed") {
        return res.status(400).send({
          message: "Booking is not completed yet",
        });
      }

      if (booking.paymentStatus === "paid") {
        return res.status(400).send({
          message: "This booking is already paid",
        });
      }

      const amount = Number(booking.finalAmount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).send({
          message: "Invalid payment amount",
        });
      }

      const session = await stripe.checkout.sessions.create({

        mode: "payment",

        customer_email: req.user.email,

        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: booking.serviceTitle || "FixMate Service",
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],

        metadata: {
          bookingId: booking._id.toString(),
          customerEmail: req.user.email,
        },

        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
      });

      res.send({
        url: session.url,
      });
    } catch (error) {
      console.error("Stripe Checkout Error:", error);

      res.status(500).send({
        message: "Failed to create checkout session",
      });
    }
  }
);


app.get(
  "/api/payments/verify",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { session_id } = req.query;

   
      if (!session_id) {
        return res.status(400).send({
          message: "Session ID is required",
        });
      }


      const session = await stripe.checkout.sessions.retrieve(
        session_id
      );

  
      if (session.payment_status !== "paid") {
        return res.status(400).send({
          message: "Payment is not completed",
        });
      }

      if (!session.amount_total || session.amount_total <= 0) {
        return res.status(400).send({
          message: "Invalid payment amount",
        });
      }

    
      const { bookingId, customerEmail } = session.metadata || {};

      if (customerEmail !== req.user.email) {
        return res.status(403).send({
          message: "Access forbidden",
        });
      }

    
      if (!ObjectId.isValid(bookingId)) {
        return res.status(400).send({
          message: "Invalid booking ID",
        });
      }

  
      const booking = await bookings.findOne({
        _id: new ObjectId(bookingId),
        customerEmail: req.user.email,
      });

      if (!booking) {
        return res.status(404).send({
          message: "Booking not found",
        });
      }

    
      if (session.metadata?.bookingId !== booking._id.toString()) {
        return res.status(403).send({
          message: "Invalid payment session for this booking",
        });
      }

      
      if (booking.status !== "completed") {
        return res.status(400).send({
          message: "Booking is not completed",
        });
      }


      if (booking.paymentStatus === "paid") {
        return res.status(400).send({
          message: "Booking is already paid",
        });
      }

    
      if (session.currency !== "bdt") {
        return res.status(400).send({
          message: "Invalid payment currency",
        });
      }

      
      const expectedAmount = Math.round(
        Number(booking.finalAmount) * 100
      );

      if (session.amount_total !== expectedAmount) {
        return res.status(400).send({
          message: "Payment amount does not match booking amount",
        });
      }


      const existingPayment = await payments.findOne({
        transactionId: session.payment_intent,
      });

      if (existingPayment) {
        return res.send({
          message: "Payment already verified",
          amount: existingPayment.amount,
          transactionId: existingPayment.transactionId,
          paymentDate: existingPayment.paymentDate,
          paymentId: existingPayment._id,
          payment: existingPayment,
        });
      }

    
      const payment = {
        bookingId: booking._id.toString(),
        customerEmail: booking.customerEmail,
        technicianEmail: booking.technicianEmail,
        serviceTitle: booking.serviceTitle,
        amount: session.amount_total / 100,
        transactionId: session.payment_intent,
        paymentDate: new Date(),
      };

      const paymentResult = await payments.insertOne(payment);

    
      await bookings.updateOne(
        {
          _id: booking._id,
          paymentStatus: { $ne: "paid" },
        },
        {
          $set: {
            paymentStatus: "paid",
          },
        }
      );

      
      res.send({
        message: "Payment verified successfully",
        amount: payment.amount,
        transactionId: payment.transactionId,
        paymentDate: payment.paymentDate,
        paymentId: paymentResult.insertedId,
      });

    } catch (error) {
      console.error("Payment verification error:", error);

      if (error.code === 11000) {
        return res.status(409).send({
          message: "Payment already exists for this booking",
        });
      }

      res.status(500).send({
        message: "Payment verification failed",
      });
    }
  }
);

app.use((req, res) => {
  res.status(404).send({
    message: "Route not found",
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Server failed to start:", error.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await client.close();
      console.log("MongoDB connection closed.");
      process.exit(0);
    } catch (error) {
      console.error("Error closing MongoDB connection:", error.message);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
