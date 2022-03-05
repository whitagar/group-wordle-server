var express = require("express"); 
var app = express();
var bodyParser = require("body-parser");
var path = require("path")
var uuid = require('uuid-random');

const { uniqueNamesGenerator, adjectives, colors, animals, names } = require('unique-names-generator');

// Running our server on port 3080
var PORT  = process.env.PORT || 3080

var server = app.listen(PORT, function() {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Listening at http://%s:%s', host, port);
});

app.use(bodyParser.json());

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

var io = require('socket.io')(server)

var connectedClients = {}
var rooms = {}

io.on('connection', (client) => {

  console.log("New client connected");

  //Client sent a message
  client.on("SendMessage", (messageData, roomId) => {
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    room.chatRoomData.push(messageData)
    sendUpdatedChatRoomData(room)
    console.log("new message sent to room: ", roomId, messageData.message)
  })

  //Client created room
  client.on("CreateRoom", (roomId) => {
    rooms[roomId] = {id: roomId, clientsInRoom: [], chatRoomData: []}
    console.log('Created room: ', roomId)
  })

  //Client entered the chat room
  client.on("UserEnteredRoom", (userData, roomId) => {
    console.log("client entered room", userData)
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    var enteredRoomMessage = {
      message: `${userData.username} has entered the waiting room`, 
      username: userData.username, 
      userID: userData.id, 
      timeStamp: new Date(),
    }
    if (room) {
      room.chatRoomData.push(enteredRoomMessage)
      connectedClients[client.id] = userData
      room.clientsInRoom.push(client)
      sendUpdatedChatRoomData(room)
      sendUpdatedPlayersList(room);
    }
  })

  //Player Disconnecting from chat room...
  client.on('disconnecting', (roomId) => {
    let room = rooms[roomId]
    console.log("Client disconnecting...");

    if (!room) {
      kick(client);
      return;
    }

    if (connectedClients[client.id]) {
      var leftRoomMessage = {
        message: `${connectedClients[client.id].username} has left the chat`, 
        username: "", 
        userID: 0, 
        timeStamp: null,
      }
      room.clientsInRoom = room.clientsInRoom.filter((c) => connectedClients[c.id] !== connectedClients[client.id])
      room.chatRoomData.push(leftRoomMessage)
      if (room.id === connectedClients[client.id].id) {
        tearDownRoom(roomId)
      } else {
        sendUpdatedChatRoomData(room)
        sendUpdatedPlayersList(room)
      }
      
      delete connectedClients[client.id]
    }
  });

  //Clearing Chat room data from server
  client.on('ClearChat', (roomId) => {
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    room.chatRoomData=[]
    console.log(room.chatRoomData)
    sendUpdatedChatRoomData(room)
  })

  // Host starts game
  client.on('HostStartGame', (roomId) => {
    console.log('Host starting game: ', roomId);
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    sendStartGame(room)
  })

  //Player chooses word
  client.on('SetWord', (roomId, word) => {
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    var userData = connectedClients[client.id]
    userData.hasWord = true;
    userData.word = word
    connectedClients[client.id] = userData
    console.log(`${userData.username} set their word to ${userData.word}`)
    checkIfAllPlayersHaveSetWord(roomId)
  })

  client.on('SetRoundScore', (roomId, roundId, score) => {
    let room = rooms[roomId]
    if (!room) {
      kick(client);
      return;
    }
    var userData = connectedClients[client.id]
    userData.scores[roundId] = score
    
    connectedClients[client.id] = userData;
    console.log(`${userData.username} got a score of ${score} in round ${roundId}`)
    checkIfAllPlayersHaveRoundScore(roomId, roundId);
  })
  

});


//Sending update chat room data to all connected clients
function sendUpdatedChatRoomData(room){
  room.clientsInRoom.forEach((c) => {
    c.emit('RetrieveChatRoomData', room.chatRoomData);
    console.log('Sending updated chat room data to', connectedClients[c.id])
  })
}

//Send updated list of players
function sendUpdatedPlayersList(room) {
  var playersList = []
  room.clientsInRoom.forEach((c) => {
    playersList.push(connectedClients[c.id])
  })
  console.log("players list: ", playersList)
  room.clientsInRoom.forEach((c) => {
    c.emit('RetrievePlayersList', playersList);
    console.log('sending players list to: ', connectedClients[c.id])
  })
}

function tearDownRoom(roomId) {
  let room = rooms[roomId];

  room.clientsInRoom.forEach((c) => {
    c.emit('RoomDestroyed')
  })
  console.log('Destroying room')
  delete rooms[roomId]
}

function kick(client) {
  client.emit('RoomNotAvailable');
  console.log('Room was not available');
}

function sendStartGame(room) {
  room.clientsInRoom.forEach((c) => {
    c.emit('StartGame')
  })
  console.log('Game starting with id: ', room.id)
}

function checkIfAllPlayersHaveSetWord(roomId) {
  let room = rooms[roomId];
  if (room.clientsInRoom.every((c) => {
    return connectedClients[c.id].hasWord
  })) {
    let wordsMap = {}
    room.clientsInRoom.forEach((c) => {
      wordsMap[connectedClients[c.id].id] = connectedClients[c.id].word
    })
    room.clientsInRoom.forEach((c) => {
      c.emit('SetWordsMap', wordsMap);
    })
    startNextRound(roomId);
  }
}

function checkIfAllPlayersHaveRoundScore(roomId, roundId) {
  let room = rooms[roomId]
  if (room.clientsInRoom.every((c) => {
    return roundId in connectedClients[c.id].scores
  })) {
    console.log('All players have round score. Moving to next round.');
    startNextRound(roomId);
  } else {
    console.log('Waiting for all players to have round score.');
  }
}

function startNextRound(roomId) {
  let room = rooms[roomId];
  if (room.clientsInRoom.every((c) => {
    return connectedClients[c.id].turnTaken
  })) {
    let allScores = {}
    let maxScore = 0;
    let winningUsername = '';
    room.clientsInRoom.forEach((c) => {
      const totalScore = Object.values(connectedClients[c.id].scores).reduce((partialSum, score) => partialSum + score, 0);
      const username = connectedClients[c.id].username
      allScores[username] = totalScore;
      if (totalScore >= maxScore) {
        maxScore = totalScore;
        winningUsername = username;
      }
    })
    room.clientsInRoom.forEach((c) => {
      c.emit('GameOver', allScores, maxScore, winningUsername);
    })
    console.log('Game over. Tearing down room');
    tearDownRoom(roomId);
  } else {
    let nextPlayer = room.clientsInRoom.find((c) => {
      return !connectedClients[c.id].turnTaken
    })
    connectedClients[nextPlayer.id].turnTaken = true;
    room.clientsInRoom.forEach((c) => {
      c.emit('StartRound', connectedClients[nextPlayer.id].word, connectedClients[nextPlayer.id].id)
    })
    console.log('Starting new round...');
  }
}
