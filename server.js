var express = require('express'),
	bodyParser = require('body-parser'),
	cookieParser= require('cookie-parser'),
	crypto = require('crypto'),
	app = express(),
	pgp = require("pg-promise")(),
	db = pgp("postgres://postgres:postgres@127.0.0.1:5432/microblog");

	app.use(bodyParser.urlencoded( {extended:true } ) );
	app.use(cookieParser());

	app.use(express.static(__dirname));

function GetMD5ofString(str){
	return crypto.createHash('md5').update(str).digest('hex');
}

function IsAuth(req,res,callback){
	if((!!req.cookies.email)&&(!!req.cookies.password)){
		var email = req.cookies.email;
		var password = req.cookies.password;
		db.oneOrNone('SELECT id,name,email FROM users WHERE LOWER(email)=LOWER(\''+email+'\') AND password=\''+password+'\'')
			.then(function(data){
				if(data===null){
					res.clearCookie('email');
					res.clearCookie('password');
					callback({id: -1});
				} else {
					callback(data);
				}
			})
			.catch(error=>{
				callback({id: -2});
			});
	} else {
		callback({id:-3});
	}
}

app.get('/',function(req,res){
	res.redirect('auth');
});

app.get('/auth',function(req,res){ 
	IsAuth(req,res,function(i){
		if(i.id>0){
			res.redirect('/profile/'+i.id);
		} else {
			res.render('auth.ejs');
		}			
	});
});


app.post('/api/auth',function(req,res){
	var email = req.body.email,
		password = req.body.password;

	if((email.length>0)&&(password.length>0))
	{
		db.oneOrNone('SELECT * FROM users WHERE LOWER(email)=LOWER(\''+email+'\') AND password=MD5(\''+password+'\')')
		.then(function(data){
			if(data===null){
				res.send(JSON.stringify({ "message": "1" }));
				return;
			}
			else
			{
				res.cookie('email', email);
				res.cookie('password', GetMD5ofString(password));
				res.send(JSON.stringify({ "message": "0", "id": data.id} ));
				return;
			}
		})
		.catch(error => {
			res.send(JSON.stringify({ "message": "2" }));
			return;
		});
	}
	else{
		res.send(JSON.stringify({"message": '3' }));
		return;
	}
});

app.get('/api/logout',function(req,res){
	res.clearCookie('email');
	res.clearCookie('password');
	res.redirect('/auth');
});

app.get('/register',function(req,res){
	IsAuth(req,res,function(i){
		if(i.id>0){
			res.redirect('/profile/'+i.id);
		} else {
			res.render('register.ejs');
		}
	});
});

app.post('/api/register',function(req,res){
	var name = req.body.name,
		email = req.body.email,
		password = req.body.password;

	if(email.length==0){
		res.send(JSON.stringify({ "message": "1" }));
		return;
	} else if (password.length==0){
		res.send(JSON.stringify({ "message": "2" }));
		return;
	}
	var sql;
	if(name.length>0){
		sql = 'INSERT INTO users(name ,email, password) VALUES (\''+name+'\',\''+email+'\',MD5(\''+password+'\') )';
	} else {
		sql = 'INSERT INTO users(email, password) VALUES (\''+email+'\',MD5(\''+password+'\') )';
	}
	db.none(sql)
	.then(function(){
		res.send(JSON.stringify({"message":"0"}));
	})
	.catch(error => {
		res.send(JSON.stringify({"message":"3"}));
	});
});

String.prototype.replaceAll = function(search, replace){
	return this.split(search).join(replace);
}

app.get('/profile/:id', function(req, res) {
	var posts,
		user,
		id = req.params.id;
	db.oneOrNone('SELECT id, name ,email FROM users WHERE id='+id)
		.then(function (data){
			user = data;
			if(user===null){
				res.send('Вероятно данного пользователя не существует');
				return;
			}
			db.manyOrNone('SELECT * FROM posts WHERE id_owner='+id+' ORDER BY id DESC')
				.then(function (data) {
					posts= data;
					IsAuth(req,res,function(i){

							user.email=GetMD5ofString(user.email.toLowerCase());
						if(i.id>0){ 
							res.render('profile.ejs',{i:i, user: user, posts: posts} );
						} else {
							res.render('profile.ejs',{ user: user, posts: posts} );	
						}
					});
				})
				.catch(function(error){
				})
		.catch(function(error){
		});
	});
});

function UpdatePost(id_owner,id_post,title,content,callback){
	db.none('UPDATE posts SET title=\''+title+'\', content=\''+content+'\' WHERE id='+id_post+' AND id_owner='+id_owner)
	.then(function(){
		callback('Запись ${title} изменена');
	})
	.catch(error =>{
		callback('Что-то пошло не так, попробуйте позже');
	})
}

app.post('/api/update_post',function(req,res){
	IsAuth(req,res,function(i){
		var id_post = req.body.id;
		title = req.body.title,
		content = req.body.content;
		if((id_post.length>0)&&(title.length>0)&&(content.length>0)){
			UpdatePost(i.id, id_post, title, content, function(message){
				res.send(JSON.stringify({"message": "1"}));
			});
		}
	});
});

function AddPost(id_owner,title,content,callback){
	db.none('INSERT INTO posts(id_owner,title,content) VALUES ('+id_owner+',\''+title+'\',\''+content+'\')')
	.then(function(){
		callback('Запись \''+title+'\' создана');
	})
	.catch(error => {
		callback('Что-то пошло не так, попробуйте позже');
	});
}

app.route('/api/add_post')
.post(function(req,res){
	IsAuth(req,res,function(i){

		var title = req.body.title,
		content = req.body.content;

		AddPost(i.id, title, content, function(message){
			res.redirect('/profile/'+i.id);
		});
	});
});


app.get('/edit_profile',function(req,res){
	IsAuth(req,res,function(i){

		if(i.id>0){
			res.render('edit_profile.ejs',{i: i});
		} else {
			res.redirect('auth');
		}
	})
})

app.post('/api/edit_profile',function(req,res){
	if(req.body.name==0){
		res.send(JSON.stringify({"message": "1"}));
		return;
	}
	IsAuth(req,res,function(i){
		if(i.id>0){
			var name = req.body.name;

			db.none('UPDATE users SET name=\''+name+'\' WHERE id ='+i.id)
			.then(function(){
				res.send(JSON.stringify({"message": "0"}));
			})
			.catch(error => {
				res.send(JSON.stringify({"message": "2"}));
			});
		} else {
			res.redirect('auth');
		}
	})
});

app.get('/api/remove_post',function(req,res){
	IsAuth(req,res,function(i){
		if(i.id>0){
			id_post = req.query.id;

			db.none('DELETE FROM posts WHERE id='+id_post+' AND id_owner='+i.id)
			res.redirect('/profile/'+i.id);
		} else {
			res.redirect('/auth');
		}
	});
});

function SearchUser(name,callback){
	db.manyOrNone('SELECT u.id,u.name, u.email, coalesce(count(p.*), 0) count '+
					'FROM users u '+
					'LEFT JOIN posts p ON u.id=p.id_owner '+
					'WHERE LOWER(u.name) LIKE LOWER(\''+name+'%\') '+
					'GROUP BY u.id '+
					'ORDER BY count DESC')
	.then(function (data) {
		callback(data);
	})
}

app.get('/search/',function(req,res){
	IsAuth(req,res,function(i){

		var q= req.query.q;

		SearchUser(q,function(users){
			users.forEach(function(entry){
				entry.email=GetMD5ofString(entry.email.toLowerCase());
			});
			if (i.id>0){
				res.render('search.ejs',{ users: users, i:i, q: q });
			} else {
				res.render('search.ejs',{ users: users, q: q });
			}
		});
	});
});

var server = app.listen(80, function(){
	console.log('Start on port 80');
});