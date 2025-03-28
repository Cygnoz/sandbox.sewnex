require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const server = express();
const customerRouter = require("./router/customerRouter");
require('./database/connection/connection');


server.use(express.json({ limit: '10mb' })); 
server.use(express.urlencoded({ limit: '10mb', extended: true }));

server.use(cors({
    origin: "*",
    methods: "GET, POST, PUT, DELETE, OPTIONS",
    allowedHeaders: "Content-Type, Authorization"
}));

server.options('*', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.sendStatus(200);
});

server.use(helmet());
server.use(express.json())
server.use(customerRouter)

const PORT = 4002

server.get('/',(req,res)=>{
    res.status(200).json("SBX Sewnex server started - Customer v1.0")
})

const app = server.listen(PORT, () => {
    console.log(`Sewnex server Customer started at port : ${PORT}`);
});


