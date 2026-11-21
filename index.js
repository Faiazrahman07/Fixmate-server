import express from 'express';
import cors from 'cors';
import { MongoClient } from "mongodb";
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
await connectToMongoDB();
app.use(express.json());
app.use(cors());
app.get('/', (req, res ) => {
  res.send('Hello World!');
});

app.listen(PORT,()=>{
    console.log(`server is running on port ${PORT}`);
});