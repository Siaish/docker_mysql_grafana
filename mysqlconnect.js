const express = require('express'); // 1. Import Express
const app = express();            // 2. Initialize the app
const port = 1500;                // 3. Set a port
const mysql = require('mysql2');  //npm install mysql2

//middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }));

const connection = mysql.createConnection({
  host: "127.0.0.1",
  port: '3314',
  user: "",
  password: "",
  database: 'db',
});

//connection.connect();

connection.connect(function (error) {
  if (error) { console.log(error) }
  else { console.log("Connected!") };
});


app.get('/check', (req, res) => {


  connection.query('SELECT * from userstable', (error, rows, fields) => {
    if (error) {
      console.log(error)
      res.status(500).send("some issues")
    }
    else { res.status(200).send("connected to database : 'simran' and table 'userstable'") }

  });
});

app.all('/createtable', (req, res) => {
  let sql = `CREATE TABLE IF NOT EXISTS Call_CX (
      time_stamp VARCHAR(50),
      agent VARCHAR(50),
      wksid VARCHAR(50),
      call_sid VARCHAR(50),
      task VARCHAR(50),
      phoneno VARCHAR(20)
    );`

  // let sql = `CREATE TABLE IF NOT EXISTS Chat_CX (
  //     time_stamp_ch VARCHAR(50),
  //     agent_ch VARCHAR(50),
  //     wksid_ch VARCHAR(50),
  //     chat_ch VARCHAR(50),
  //     task_ch VARCHAR(50),
  //     phoneno VARCHAR(20)
  //   );`

  connection.query(sql, (error, rows, fields) => {
    if (error) {
      console.log(error)
      res.status(500).send(error)
    }
    else {
      console.log("Created table successfully!")
      res.status(200).send("Created 1 table success!")
    }

  })


})

app.post('/insert', (req, res) => {


  let event = req.body.EventType
  let tabledescsn = req.body.TaskQueueTargetExpression
  let workflow = req.body.WorkflowName
  let worker_sid = req.body.WorkerSid
  let worker_name = req.body.WorkerName
  let task_sid = req.body.TaskSid
  let timestamp = req.body.Timestamp
  const date = new Date(timestamp * 1000);
  const final_timestamp = date.toUTCString()

  let afterparse = JSON.parse(req.body.TaskAttributes)
  let callsid = afterparse.call_sid
  let caller = afterparse.caller
  let conversation_sid = afterparse.conversationSid
  let customerph = afterparse.customerAddress



  if (tabledescsn.includes("voice_support")) {


    let sql = `INSERT INTO Call_CX(time_stamp, agent, wksid, call_sid, task, phoneno) VALUES (?,?,?,?,?,?)`;
    let values = [final_timestamp, worker_name, worker_sid, callsid, task_sid, caller];

    connection.query(sql, values, function sim(error, rows, fields) {
      if (error) {
        console.log(error)
        res.status(500).send(error)
      }
      else {
        console.log("Inserted 1 record successfully!")
        res.status(200).send("Inserted 1 record success!")
      }

    })
  }
  else {


    let sql = `INSERT INTO Chat_CX(time_stamp_ch, agent_ch, wksid_ch, chat_ch, task_ch, phoneno) VALUES (?,?,?,?,?,?)`;

    let values = [final_timestamp, worker_name, worker_sid, conversation_sid, task_sid, customerph];
    connection.query(sql, values, function sim(error, rows, fields) {
      if (error) {
        console.log(error)
        res.status(500).send(error)
      }
      else {
        console.log("Inserted 1 record successfully!")
        res.status(200).send("Inserted 1 record success!")
      }

    })
  }



})

// 5. Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
