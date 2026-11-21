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
app.listen(PORT,()=>{
    console.log(`server is running on port ${PORT}`);
});