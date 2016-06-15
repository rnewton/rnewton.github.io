---
layout: post
title: Domain Driven Design in Go
date: 2016-06-15
---

Lately I've been on a Go kick. And as a part of that I wanted to try to setup a project skeleton for myself to rapidly develop services. I have nothing against some of the other frameworks like [Kite](https://github.com/koding/kite) or [go-kit](https://github.com/go-kit/kit), but they just don't quite match up with the way I like to work. [Domain Driven Design](https://en.wikipedia.org/wiki/Domain-driven_design) is a methodology for organizing projects in a way that is scaleable and easy to work with. It certainly requires some discipline to work with, but can be rewarding when things come together.

The whole project looks like...

```golang
app
├── Godeps
│   └── Godeps.json
├── application
│   └── thing_service.go
├── cmd
│   └── app
│       └── app.go
├── db
│   ├── 0001_CreateThingTables.down.sql
│   └── 0001_CreateThingTables.up.sql
├── domain
│   ├── other_thing.go
│   └── thing.go
├── infrastructure
│   ├── configuration.go
│   ├── container.go
│   ├── persistence
│   │   ├── db
│   │   │   ├── game_client_repository.go
│   │   │   ├── score_repository.go
│   │   │   └── user_repository.go
│   │   └── memory
│   │       ├── game_client_repository.go
│   │       ├── score_repository.go
│   │       └── user_repository.go
│   └── session.go
├── ui
│   ├── routes.go
│   └── thing_controller.go
└── vendor
    └── ...
```

We should probably start with the domain layer... as this is Domain Driven Design. Let's take a look at `domain/thing.go`:

```golang
package domain

// Thing is an entity, just go with it
type Thing struct {
	ID             int    `db:"id"`
	Name           string `db:"name"`
	Description    string `db:"description"`
}

// ThingRepository describes the interface for interacting with Things
type ThingRepository interface {
	All() ([]Thing, error)
    ThingOfID(id int) (*Thing, error)
    Save(thing *Thing) error
    Delete(thing *Thing) error
}
```

We'll place all our domain entities in the... domain package. Grouping things like this helps keep the layers clean and focused. The only thing going on in the domain layer is definitions for our entities and the interfaces that we'll use to interact with them. We can have single-entity or aggregate-root business logic here as well, but the code describing the interactions between entities belongs in the application layer.

```golang
package application

import "app/domain"

// ThingService provides methods for interactions between Things and OtherThings
type ThingService struct {
	ThingRepo domain.ThingRepository
    OtherRepo domain.OtherThingRepository
}

// All returns all the Things
func (s *ThingService) All() ([]domain.Thing, error) {
	return s.ThingRepo.All()
}

...

// SaveThing saves a new Thing or updates an existing one
func (s *ThingService) SaveThing(thing *domain.Thing) error {
	thing := domain.Thing{
		...
	}

	if err := s.ThingRepository.Save(&thing); err != nil {
        return err
    }

    otherThing := domain.DoSomethingWithThing(&thing)
    ...
}
```

So in the application layer we use dependency injection to get the necessary resources into the application services. Like Database Repositories, API handlers, logging, etc. The functions within the application services can be as simple as pass-throughs to a dependency's own handler _or_ they can be much more complex and operate on the entities. The bulk of the interesting stuff that an application does happens here. But... nothing works without infrastructure. The concrete implementations of the interfaces that we defined in our domain layer, injected into the application services. Let's take a look at a repository first:

```golang
package db

import (
	"app/domain"

	"github.com/jmoiron/sqlx"
)

// ThingRepository concrete implementation for talking to the database
type ThingRepository struct {
	DB *sqlx.DB
}

// ThingOfID returns a Thing given an ID
func (r *ThingRepository) ThingOfID(id int) *domain.Thing {
	thing := &domain.Thing{}
	r.DB.Get(thing, "select * from thing where id = $1", id)
	if thing == nil {
		return nil
	}

	return thing
}

...
```

A repository retrieves the underlying data for our entities. The data can be pulled from databases, APIs, files, wherever. The important thing is to have the repositories be single purpose. If you need to retrieve data from multiple sources, you should have multiple repositories and merge the data together in the application service... which would make defining a good interface in the domain very important so you don't have something that's too strict or too open. If you do need to access specific public functions in a repository, you can always cast to the specific implementation, but it can get messy quick. (Something like... `apiRepo := r.APIRepo.(api.APIRepository); apiRepo.SomeAPISpecificMethod()`)

So getting all of this organized... I debated several methods, but I settled on something similar to [pimple](http://pimple.sensiolabs.org/). Yes, yes. I am from the PHP world, but hear me out. The dependency injection container pattern combined with a strictly typed language makes for a good system of organizing dependencies explicitly and cleanly. Something like:

```golang
package infrastructure

import (
	"app/application"
	"app/infrastructure/persistence/db"
	"app/infrastructure/persistence/memory"
	"log"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"                         // sqlx driver for postgres
	_ "github.com/mattes/migrate/driver/postgres" // migrate driver for postgres
)

// Container is a global structure for holding references to application resources
type Container struct {
	config *Configuration
	db     *sqlx.DB

	// Application Services
	thingService *application.ThingService

	// Repositories
	dbThingRepo        *db.ThingRepository
    dbOtherThingRepo   *db.OtherThingRepository
	memThingRepo       *memory.ThingRepository
    memOtherThingRepo  *memory.OtherThingRepository
}

// Config returns the infrastructure configuration
func (c *Container) Config() *Configuration {
	if c.config == nil {
		c.config = LoadConfiguration()
	}

	return c.config
}

// Database returns a postgresql database connection
func (c *Container) Database() *sqlx.DB {
	if c.db == nil {
		db, err := sqlx.Connect("postgres", c.Config().DatabaseURL)
		if err != nil {
			log.Fatal("Failed to connect to database.")
		}

		c.db = db
	}

	return c.db
}

// Application Services

// ThingService returns an initialized ThingService
func (c *Container) ThingService() *application.ThingService {
	if c.gameService == nil {
		c.gameService = &application.ThingService{
			ThingRepo: c.DBThingRepository(),
			OtherRepo: c.DBOtherThingRepository(),
		}
	}

	return c.gameService
}

// Repositories

// DBThingRepository returns an initialized ThingRepository backed by the database
func (c *Container) DBThingRepository() *db.ThingRepository {
	if c.dbThingRepo == nil {
		c.dbThingRepo = &db.ThingRepository{
			DB: c.Database(),
		}
	}

	return c.dbThingRepo
}

...
```

The container is a way for you to build everything from the ground up. Application resources are lazy-loaded only when needed, reusable, and modular. Again, it takes a bit of discipline to use this pattern and not let it leak into other layers. It's really just one large factory for all application resources.

That wraps up the part of the application that is completely independent of user interaction. The domain, application and infrastructure layers really shouldn't accept any input. They can bootstrap resources and gather data, but they don't talk to users. That's where the UI layer comes in. It can be pretty much anything-- Dynamic web application, a RESTful API or a command line app... or all of the above. Just depends on what you need. I'll post an example using my favorite web framework, [Gin](https://github.com/gin-gonic/gin).

First, the router:

```golang
package ui

import (
	"app/infrastructure"
	"log"

	"github.com/gin-gonic/gin"
)

// SetupRoutes adds all the routes
func SetupRoutes(router *gin.Engine) {
	// Health Checks
	router.HEAD("/ping", pong)
	router.GET("/ping", pong)

	container := infrastructure.Container{}

	apiV1(router, container)
	apiV2(router, container)
}

func pong(c *gin.Context) {
	c.String(200, "pong")
}

func apiV2(router *gin.Engine, container infrastructure.Container) {
	// Updated API routes accessible via a game client
	apiV2 := router.Group("/api/v2")
	{
		thingController := ThingController{
			ThingService: *container.ThingService(),
		}
		things := apiV2.Group("/things")
		{
			things.GET("", thingController.All)
			things.GET("/:id", thingController.ThingOfID)
            things.PUT("/:id", thingController.UpdateThing)
            things.POST("", thingController.CreateThing)
            things.DELETE("/:id", thingController.DeleteThing)
		}
	}
}

...
```

Which can dynamically setup routes for Gin. The controllers are created by group and use resources from the infrastructure container. We could easily adapt the container to store the controllers as well, but I haven't seen a need for it so far. The controllers look something like:

```golang
package ui

import (
	"app/application"

	"github.com/gin-gonic/gin"
)

// ThingController handles /things routes
type ThingController struct {
	ThingService application.ThingService
}

// Things will get all the Things
func (u *ThingController) Things(c *gin.Context) {
	things, err := u.ThingService.Things()
	if err != nil {
		c.JSON(500, gin.H{"Message": err.Error()})
		return
	}

	c.JSON(200, gin.H{"Message": "OK", "Data": things})
}

...
```

I haven't put as much effort into time-saving or conciseness in the controllers. The `{"Message": "...", "Data": {}}` output is entirely self-enforced, but could easily be standardized using a struct and some sort of middleware after the controller function that validates the output. Writing microservices has allowed me to get away without doing that so far at least!

You can easily add some html and static rendering into this mix and serve up actual html pages instead of an API. Or you can serve up a single index.html and create a single-page app using javascript (or [gopherjs](https://github.com/gopherjs/gopherjs)) and hit the backend api via AJAX. And all of that can be done without having to modify the application, domain or infrastructure layers. There's a lot more to Domain Driven Design, Gin and Go that I could talk about here, but I think I'll wrap it up for now.
