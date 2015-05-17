var Face = require('./node_modules/ndn-js').Face;
var Name = require('./node_modules/ndn-js').Name;
var Data = require('./node_modules/ndn-js').Data;
var Blob = require('./node_modules/ndn-js').Blob;
var Interest = require('./node_modules/ndn-js').Interest;
var UnixTransport = require('./node_modules/ndn-js').UnixTransport;
var Exclude = require('./node_modules/ndn-js').Exclude;
var Crypto = require('crypto');

var face = new Face(new UnixTransport());	// connect to a default hub/proxy

var USER_TIMEOUT = 60000;
var MSG_MARKER = "%%";

/****************************************************

  BigBoard(); embedded class BigBoard; 
  defining class with its constructor.

****************************************************/
var BigBoard = function BigBoard(exclude) {
  this.chalkBoard = [];
  this.roaster = [];
  this.chalkBoardDigest = [];

  this.callRoll(exclude);
}

/****************************************************

  BigBoard.ChalkBoard(); embedded class BigBoard.ChalkBoard; 
  defining class with its constructor.

****************************************************/
BigBoard.ChalkBoard = function (uid, seq, msg, time)
{
  this.uid = uid;
  this.seq = seq;
  this.msg = msg;
  this.time = time;
  this.posted = false;
};

/****************************************************

  BigBoard.Runner(); embedded class BigBoard.Runner; 
  defining class with its constructor.

****************************************************/
BigBoard.Runner = function (uid, timestamp, exclude)
{
  this.uid = uid;
  this.timestamp = timestamp;
  this.exclude = exclude;
};

/****************************************************

  BigBoard.postToBoard() loops through 
  BigBoard.chalkBoard[] array, prints any new
  message onto the screen and marks it as posted.

****************************************************/
BigBoard.prototype.postToBoard = function() {
  
  for (var i = 0  ; i < this.chalkBoard.length; i++) {
    if (!(this.chalkBoard[i].posted)) {
      console.log(this.chalkBoard[i].uid +
	 " (" + new Date(this.chalkBoard[i].time).toISOString() + "): " + 
	this.chalkBoard[i].msg);
      this.chalkBoard[i].posted = true;
    }
  }
};

/****************************************************

  BigBoard.postToQueue() accepts a ChalkBoard object
  and pushes it to the Runner.chalkBoard[]; it also
  sorts the array by message sent time.

****************************************************/
BigBoard.prototype.postToQueue = function(chat) {
    
  this.chalkBoard.push(chat);
  this.chalkBoard.sort(function(a, b) { return a.time - b.time });
}

/****************************************************

  BigBoard.onMessageData() gets uid and sequence
  number from the message data; it also extracts the 
  sent time and the message text from data content;
  it evaluates a hash digest of all elements above and
  tries to find it from the BigBoard.chalkBoardDigest[]
  array. Only a unique message shall be sent to the 
  BigBoard.postToQueue() function for further process 
  while its hash digest shall also be stored. In the 
  end, it appends the message's seq to the exclude 
  and fires BigBoard.getMessages() again.

****************************************************/
BigBoard.prototype.onMessageData = function(interest, data) {

  var uid = data.getName().getComponent(1).toString();
  var seq = data.getName().getComponent(2).toString();

  var buf = data.getContent().buffer.toString();
  var markerPos = buf.indexOf(MSG_MARKER);
  var msg = buf.slice(markerPos+2);
  var time = Number(buf.slice(0, markerPos));

  var exclude = interest.getExclude().appendComponent(seq);

  for (var i = this.roaster.length; i > 0; i--) {
    if (this.roaster[i-1].uid == uid) {
      this.roaster[i-1].exclude = exclude;
    }
  }

  var hash = Crypto.createHash('sha1');
  hash.update(uid);
  hash.update(seq);
  hash.update(buf);	

  var hashDigest = hash.digest('hex');
  if (this.chalkBoardDigest.indexOf(hashDigest) == -1) {
    this.chalkBoardDigest.push(hashDigest);
    this.postToQueue(new BigBoard.ChalkBoard(uid, seq, msg, time));
  }
  this.getMessages(uid, exclude);

}

/****************************************************

  BigBoard.getMessages() sends interest to 
  /messages/<uid> prefix and accepts exclude to 
  enumerate each message; it also binds the current
  BigBoard instance to the onData callback.

****************************************************/
BigBoard.prototype.getMessages = function(uid, exclude){

  var interest = new Interest(new Name("/messages")); 
  interest.setName(interest.getName().append(uid));
  
  interest.setChildSelector(0);
  interest.setExclude(exclude);
//console.log('Message Seq Interest with Exclude:');
//console.log(interest.toUri());
  interest.setInterestLifetimeMilliseconds(500);
  face.expressInterest(interest, this.onMessageData.bind(this)); 
}

/****************************************************

  BigBoard.beacon() loops through Runner.roaster, 
  drops any expired runner, and calls Runner.getMessages()
  for each valid runner.

****************************************************/
BigBoard.prototype.beacon = function() {

  var cutoff = new Date().valueOf() - USER_TIMEOUT;
  
  for (var i = 0; i < this.roaster.length; i++) {
    if (this.roaster[i].timestamp < cutoff) {
      // Remove all expired runner from the roaster
      this.roaster.splice(i,1);
    } else {
//console.log(this.roaster[i].uid+":"+this.roaster[i].exclude.toUri());
      this.getMessages(this.roaster[i].uid, this.roaster[i].exclude); 
    }
  }
}

/****************************************************

  BigBoard.onRunnerData() extracts uid and timestamp
  from the runner data and appends the new runner 
  or updates an existing runner to the roaster list;
  it also appends the runner's uid to the exclude
  and fires BigBoard.callRoll() again.

****************************************************/
BigBoard.prototype.onRunnerData = function(interest, data) {

  var uid = data.getName().getComponent(1);
  var exclude = interest.getExclude().appendComponent(uid);
//console.log(data.getName().toUri());
//console.log(interest.toUri());
  var timestamp = data.getName().size() >= 3 ? 
	data.getName().getComponent(2).toString() : 
	new Name.Component("1").toEscapedString();
  var cutoff = new Date().valueOf() - USER_TIMEOUT;

//console.log(Number(timestamp));
  for (var i = this.roaster.length; i >= 0; i--) {
    if (Number(timestamp) >= cutoff) {
      if (i == 0) {  
        this.roaster.push(new BigBoard.Runner(uid.toString(),
		 Number(timestamp), new Exclude()));
      } else if (this.roaster[i-1].uid == uid.toString()) {
        this.roaster[i-1].timestamp = Number(timestamp);
        break;
      }
    }
  }
//console.log(data.getName().toUri() +":" + timestamp);
  this.callRoll(exclude);  
}

/****************************************************

  BigBoard.callRoll() is called at initialization; 
  it sends interest to /users prefix and accepts 
  exclude to enumerate each runner; it also binds 
  the current BigBoard instance to the onData callback.

****************************************************/
BigBoard.prototype.callRoll = function(exclude){

  var interest = new Interest(new Name("/users")); 
  interest.setChildSelector(1);
  interest.setExclude(exclude);
//console.log('User Interest with Exclude:');
//console.log(interest.toUri());
  interest.setInterestLifetimeMilliseconds(5000);  
  interest.setMustBeFresh(true);
  face.expressInterest(interest, this.onRunnerData.bind(this), 
	this.callRoll.bind(this));
}

function main(){

  var bigBoard = new BigBoard(new Exclude());

  setInterval( function(){  
    bigBoard.beacon();
  }, 500);

  setInterval( function() {
    bigBoard.postToBoard();
  }, 500);
}

main();

    
