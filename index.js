import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId  } from "mongodb";
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 5000
const client = new MongoClient(
`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ofxhydd.mongodb.net/`);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const Connectedclient = await connectToMongoDB();
const database = Connectedclient.db("Fixmate");
const user = database.collection('user');
const services = database.collection('services');
const bookings = database.collection("bookings");
const payments = database.collection("payments");
app.use(express.json());
app.use(cors());
app.get('/', (req, res ) => {
  res.send('Hello World!');
});
app.get('/users',async(req,res)=>{
  const cursor = user.find({});
  const result  = await cursor.toArray();
  res.send(result);
});
app.get('/api/services',async(req,res)=>{
  const cursor = services.find({});
  const result  = await cursor.toArray();
  res.send(result);
});
app.get('/api/services/:id', async (req, res) => {
  const id = req.params.id;
  const result = await services.findOne({
    _id: new ObjectId(id)
  });

  res.send(result);
});
app.post('/api/services', async (req, res) => {
  const service = req.body;

  const result = await services.insertOne(service);

  res.send(result);
});
app.patch('/api/services/:id', async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  const result = await services.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
  );

  res.send(result);
});
app.delete('/api/services/:id', async (req, res) => {
  const id = req.params.id;

  const result = await services.deleteOne({
    _id: new ObjectId(id)
  });

  res.send(result);
});
app.get('/api/my-services/:email', async (req, res) => {
  const email = req.params.email;

  const result = await services.find({
    technicianEmail: email
  }).toArray();

  res.send(result);
});
app.post('/api/bookings', async (req, res) => {
  const booking = req.body;

  const result = await bookings.insertOne(booking);

  res.send(result);
});
app.get('/api/bookings/check/:serviceId/:email', async (req, res) => {
  const { serviceId, email } = req.params;

  const result = await bookings.findOne({
    serviceId,
    customerEmail: email,
    status: { $in: ["requested", "accepted", "in-progress"] }
  });

  res.send({ alreadyBooked: !!result });
});
app.get('/api/bookings/my/:email', async (req, res) => {
  const email = req.params.email;

  const result = await bookings.find({
    customerEmail: email
  }).toArray();

  res.send(result);
});
app.patch('/api/bookings/:id/cancel', async (req, res) => {
  const id = req.params.id;

  const result = await bookings.updateOne(
    {
      _id: new ObjectId(id),
      status: "requested"
    },
    {
      $set: { status: "cancelled" }
    }
  );

  res.send(result);
});
app.get('/api/bookings/technician/:email', async (req, res) => {
  const email = req.params.email;

  const result = await bookings.find({
    technicianEmail: email
  }).toArray();

  res.send(result);
});
app.patch('/api/bookings/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status, finalAmount } = req.body;

  const booking = await bookings.findOne({ _id: new ObjectId(id) });

  if (!booking) {
    return res.status(404).send({ message: "Booking not found" });
  }

  const allowedTransitions = {
    requested: ["accepted", "rejected", "cancelled"],
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

  const updateData = { status };

  if (status === "completed") {
    if (typeof finalAmount !== "number" || finalAmount <= 0) {
      return res.status(400).send({
        message: "A valid final amount is required",
      });
    }

    updateData.finalAmount = finalAmount;
  }

  const result = await bookings.updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );

  res.send(result);
});
app.get('/api/admin/users', async (req, res) => {
  const result = await user.find({}).toArray();
  res.send(result);
});
app.patch('/api/admin/users/:id/role', async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  const allowedRoles = ["customer", "technician", "admin"];

  if (!allowedRoles.includes(role)) {
    return res.status(400).send({ message: "Invalid role" });
  }

  const result = await user.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );

  res.send(result);
});
app.patch('/api/admin/services/:id/approval', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const result = await services.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );

  res.send(result);
});
app.get('/api/admin/bookings', async (req, res) => {
  const result = await bookings.find().sort({ _id: -1 }).toArray();
  res.send(result);
});
app.get('/api/admin/payments', async (req, res) => {
  const result = await payments.find().sort({ _id: -1 }).toArray();
  res.send(result);
});
app.listen(PORT,()=>{
    console.log(`server is running on port ${PORT}`);
});