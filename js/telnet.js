// Handle Telnet Connections according to RFC 854

// Telnet commands
const SE = '\xf0'
const NOP = '\xf1';
const DATA_MARK = '\xf2';
const BREAK = '\xf3';
const INTERRUPT_PROCESS = '\xf4';
const ABORT_OUTPUT = '\xf5';
const ARE_YOU_THERE = '\xf6';
const ERASE_CHARACTER = '\xf7';
const ERASE_LINE = '\xf8';
const GO_AHEAD  = '\xf9';
const SB = '\xfa';

// Option commands
const WILL  = '\xfb';
const WONT  = '\xfc';
const DO = '\xfd';
const DONT = '\xfe';
const IAC = '\xff';

// Telnet options
const ECHO  = '\x01';
const SUPRESS_GO_AHEAD = '\x03';
const TERM_TYPE = '\x18';
const IS = '\x00';
const SEND = '\x01';
const NAWS = '\x1f';

// state
const STATE_DATA=0;
const STATE_IAC=1;
const STATE_WILL=2;
const STATE_WONT=3;
const STATE_DO=4;
const STATE_DONT=5;
const STATE_SB=6;

function TelnetCore(listener) {
  this.read = null;
  this.write = null;
  this.host = null;
  this.port = 23;

  this.listener = listener;

  this.state = STATE_DATA;
  this.iac_sb = '';
  //this.b52k3uao = window.uaotable;
  this.EscChar = '\x15'; // Ctrl-U
  this.termType = 'VT100';
  this.lineWrap = 0;
  this.initial = true;

  //AutoLogin - start
  this.autoLoginStage = 0;
  this.loginPrompt = ['','',''];
  this.loginStr = ['','','',''];
  //AutoLogin - end

  this.socket = null;
}

TelnetCore.prototype.connect = function(host, port) {
  if(host) {
    this.host = host;
    this.port = port;
  }

  var conn = this;
  this.read = function(str) {
    conn.onDataAvailable(str, str.length);
  };
  this.write = function(str, length) {
    if (conn.socket == null) {
      return;
    }
    var byteArray = new Uint8Array(str.split('').map(function(x) {
      return x.charCodeAt(0);
    }));
    conn.socket.send(byteArray.buffer);
  };

  // Check AutoLogin Stage
  //this.listener.loadLoginData(); //load login data
  if(this.loginStr[1])
    this.autoLoginStage = this.loginStr[0] ? 1 : 2;
  else if(this.loginStr[2])
    this.autoLoginStage = 3;
  else
    this.autoLoginStage = 0;

  //this.initialAutoLogin();
  this.socket = new lib.Socket({
    host: this.host,
    port: this.port,
    onConnect: this.onConnect.bind(this),
    onDisconnect: this.onDisconnect.bind(this),
    onReceive: this.read,
    onSent: null
  });
  this.socket.connect();
};

TelnetCore.prototype.onConnect = function() {
  if(this.listener)
    this.listener.onConnect();
};

TelnetCore.prototype.onDisconnect = function() {
  if(this.socket) {
    this.socket = null;
  }
  if(this.listener)
    this.listener.onClose();
};

TelnetCore.prototype.onDataAvailable = function(str, count) {
  var data='';
  while (count > 0) {
    var s = str;
    count -= s.length;
    var n = s.length;
    for (var i = 0; i < n; ++i) {
      var ch = s[i];
      switch (this.state) {
      case STATE_DATA:
        if( ch == IAC ) {
          if (data) {
            this.listener.onData(data);
            data='';
          }
          this.state = STATE_IAC;
        } else {
          data += ch;
        }
        break;
      case STATE_IAC:
        switch (ch) {
        case WILL:
          this.state=STATE_WILL;
          break;
        case WONT:
          this.state=STATE_WONT;
          break;
        case DO:
          this.state=STATE_DO;
          break;
        case DONT:
          this.state=STATE_DONT;
          break;
        case SB:
          this.state=STATE_SB;
          break;
        default:
          this.state=STATE_DATA;
        }
        break;
      case STATE_WILL:
        switch (ch) {
        case ECHO:
        case SUPRESS_GO_AHEAD:
          this.send( IAC + DO + ch );
          break;
        default:
          this.send( IAC + DONT + ch );
        }
        this.state = STATE_DATA;
        break;
      case STATE_DO:
        switch (ch) {
        case TERM_TYPE:
          this.send( IAC + WILL + ch );
          break;
        case NAWS:
          this.send( IAC + WILL + ch );
          this.sendNaws();
          break;
        default:
          this.send( IAC + WONT + ch );
        }
        this.state = STATE_DATA;
        break;
      case STATE_DONT:
      case STATE_WONT:
        this.state = STATE_DATA;
        break;
      case STATE_SB: // sub negotiation
        this.iac_sb += ch;
        if ( this.iac_sb.slice(-2) == IAC + SE ) {
          // end of sub negotiation
          switch (this.iac_sb[0]) {
          case TERM_TYPE: 
            // FIXME: support other terminal types
            //var termType = this.listener.prefs.TermType;
            var rep = IAC + SB + TERM_TYPE + IS + this.termType + IAC + SE;
            this.send( rep );
            break;
          }
          this.state = STATE_DATA;
          this.iac_sb = '';
          break;
        }
      }
    }
    if (data) {
      this.listener.onData(data);
      data='';
    }
  }
};

TelnetCore.prototype.send = function(str) {
  if (str) {
    if (this.listener && this.write) {
      this.listener.resetUnusedTime();
      this.write(str, str.length);
    }
  }
};

TelnetCore.prototype.convSend = function(unicode_str) {
  // supports UAO
  // when converting unicode to big5, use UAO.
  var s = unicode_str.u2b();
  if (s) {
    this.send(s);
  }
};

TelnetCore.prototype.sendNaws = function() {
  var cols = this.listener.buf ? this.listener.buf.cols : 80;
  var rows = this.listener.buf ? this.listener.buf.rows : 24;
  var nawsStr = String.fromCharCode(Math.floor(cols/256), cols%256, Math.floor(rows/256), rows%256).replace(/(\xff)/g,'\xff\xff');
  var rep = IAC + SB + NAWS + nawsStr + IAC + SE;
  this.send( rep );
};

TelnetCore.prototype.checkAutoLogin = function(row) {
  if (this.autoLoginStage > 3 || this.autoLoginStage < 1) {
    this.autoLoginStage = 0;
    return;
  }

  var line = this.listener.buf.getRowText(row, 0, this.listener.buf.cols);
  if (line.indexOf(this.loginPrompt[this.autoLoginStage - 1]) < 0)
    return;

  var unicode_str = this.loginStr[this.autoLoginStage-1] + this.listener.view.EnterChar;
  this.send(this.convSend(unicode_str));

  if (this.autoLoginStage == 3) {
    if (this.loginStr[3])
      this.send(this.convSend(this.loginStr[3]));
    this.autoLoginStage = 0;
    return;
  }
  ++this.autoLoginStage;
};

